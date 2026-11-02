const {addMinutes, getCurrentTime, getMinutesBetween} = require('./dateUtils');
const {wrapWithPrismaTransaction} = require('./prismaTransactionUtils');
const {SYSTEM_ROLES} = require('../constants/usersConstants');

const {
  WORK_ITEM_REMINDER_OFFSETS_MINUTES,
} = require('../constants/workItemConstants');

const logger = require('../middleware/loggerMiddleware');
const UsersServices = require('../services/usersServices');

const MINUTES_PER_HOUR = 60;

// The scheduled sweeps shared by follow-up tasks and supervisory visits. Both
// run without a request, so every query bypasses ACL injection and passes
// organization ids explicitly; every transition is CAS-gated so a duplicate
// job or a second replica is a no-op.

const groupByOrganization = ({items}) => {
  const byOrg = new Map();

  for (const item of items) {
    if (!byOrg.has(item.organizationId)) byOrg.set(item.organizationId, []);
    byOrg.get(item.organizationId).push(item);
  }

  return byOrg;
};

// An item an admin already owns stays with that admin; only a missing admin
// leaves the current assignee in place.
const resolveOverdueAssignee = ({item, admin}) =>
  item.assignee?.role === SYSTEM_ROLES.admin.value || !admin.userOrgId
    ? item.assigneeUserOrganizationId
    : admin.userOrgId;

// A reminder is skipped once a shorter offset already covers the time left,
// e.g. the 24h one on an item whose due time was moved to 90 minutes away.
const isCoveredByShorterOffset = ({offsetMinutes, minutesLeft, offsets}) =>
  offsets.some((other) => other < offsetMinutes && minutesLeft <= other);

// True when this run performed the transition (CAS won).
const escalateOverdueItem = ({
  item,
  toAssignee,
  now,
  markOverdue,
  recordEvent,
  eventTypes,
  overdueStatus,
}) =>
  wrapWithPrismaTransaction({
    fn: async (tx) => {
      const {updated} = await markOverdue({
        id: item.id,
        assigneeUserOrganizationId: toAssignee,
        now,
        tx,
      });

      if (!updated) return false;

      await recordEvent({
        tx,
        item,
        type: eventTypes.becameOverdue.value,
        fromStatus: item.status,
        toStatus: overdueStatus,
      });

      if (toAssignee !== item.assigneeUserOrganizationId)
        await recordEvent({
          tx,
          item,
          type: eventTypes.escalatedToAdmin.value,
          fromAssigneeUserOrganizationId: item.assigneeUserOrganizationId,
          toAssigneeUserOrganizationId: toAssignee,
        });

      return true;
    },
  });

/**
 * Past-due open items -> overdue, handed to the org admin, everyone involved
 * notified. Per-item failures are logged and never abort the sweep.
 *
 * `notify({item, toAssignee, admin, adminIds})` runs after the commit.
 */
module.exports.runOverdueSweep = async ({
  findCandidates,
  markOverdue,
  recordEvent,
  notify,
  eventTypes,
  overdueStatus,
  logLabel,
  now = getCurrentTime(),
}) => {
  try {
    const {success, docs, error} = await findCandidates({now});

    if (!success) return {success: false, processed: 0, failed: 0, error};

    let processed = 0;
    let failed = 0;

    for (const [organizationId, items] of groupByOrganization({items: docs})) {
      const [admin, adminIds] = await Promise.all([
        UsersServices.resolveAdminForOrganization({organizationId}),
        UsersServices.getAdminUserIdsForOrganization({organizationId}),
      ]);

      if (!admin.userOrgId)
        logger.warn(
          `[${logLabel}] organization ${organizationId} has no active admin; items are marked overdue but keep their assignee`
        );

      for (const item of items) {
        try {
          const toAssignee = resolveOverdueAssignee({item, admin});

          const escalated = await escalateOverdueItem({
            item,
            toAssignee,
            now,
            markOverdue,
            recordEvent,
            eventTypes,
            overdueStatus,
          });

          if (!escalated) continue;

          await notify({item, toAssignee, admin, adminIds: adminIds.userIds});
          processed += 1;
        } catch (itemError) {
          failed += 1;
          logger.error(
            `[${logLabel}] failed for ${item.id}: ${itemError?.message || itemError}`
          );
        }
      }
    }

    return {success: true, processed, failed};
  } catch (error) {
    return {success: false, processed: 0, failed: 0, error};
  }
};

/**
 * One pass per configured offset: claim the offset on the row, log the
 * event, then remind. `notify({item, hoursLeft})` runs after the claim.
 */
module.exports.runReminderSweep = async ({
  findCandidates,
  claim,
  recordEvent,
  notify,
  getDueAt,
  eventTypes,
  offsets = WORK_ITEM_REMINDER_OFFSETS_MINUTES,
  logLabel,
  now = getCurrentTime(),
}) => {
  try {
    let sent = 0;
    let failed = 0;

    for (const offsetMinutes of offsets) {
      const {success, docs, error} = await findCandidates({now, offsetMinutes});

      if (!success) return {success: false, sent, failed, error};

      for (const item of docs) {
        const dueAt = getDueAt({item});

        // An item created inside the window (e.g. due in 90 minutes) never
        // gets the "due in 24 hours" reminder; only offsets that were still
        // ahead when it was created apply.
        const offsetInstant = addMinutes({
          date: dueAt,
          minutes: -offsetMinutes,
        });
        if (new Date(item.createdAt) > offsetInstant) continue;

        const minutesLeft = getMinutesBetween({from: now, to: dueAt});
        if (isCoveredByShorterOffset({offsetMinutes, minutesLeft, offsets}))
          continue;

        try {
          const claimed = await wrapWithPrismaTransaction({
            fn: async (tx) => {
              const {updated} = await claim({id: item.id, offsetMinutes, tx});

              if (!updated) return false;

              await recordEvent({
                tx,
                item,
                type: eventTypes.reminderSent.value,
                payload: {offsetMinutes},
              });

              return true;
            },
          });

          if (!claimed) continue;

          // Copy says how long is really left, not the offset it was sent for.
          await notify({
            item,
            hoursLeft: Math.max(1, Math.round(minutesLeft / MINUTES_PER_HOUR)),
          });

          sent += 1;
        } catch (itemError) {
          failed += 1;
          logger.error(
            `[${logLabel}] failed for ${item.id} (${offsetMinutes}m): ${itemError?.message || itemError}`
          );
        }
      }
    }

    return {success: true, sent, failed};
  } catch (error) {
    return {success: false, sent: 0, failed: 0, error};
  }
};
