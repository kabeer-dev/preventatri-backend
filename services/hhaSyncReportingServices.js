/**
 * What happens after an HHAeXchange run finishes: a socket nudge to every
 * admin.
 *
 * Each step is guarded separately -- the failure this exists to remove is
 * silence, so partial reporting beats none.
 */

const UsersServices = require('./usersServices');

const {HHAX_SYNC_RESOURCES} = require('../constants/hhaExchangeConstants');

const {
  SOCKET_EVENTS,
  SOCKET_ROOM_PREFIXES,
} = require('../constants/socketsEventConstants');

const logger = require('../middleware/loggerMiddleware');

const {buildSyncTotals} = require('../utils/hhaExchange/syncRunUtils');

const {sendPrivateSocketMessage} = require('../utils/socketUtils');

/**
 * Failed resources as registry LABELS. Never anything derived from the error:
 * HHAeXchange composes its own message text, which must not reach a user.
 */
const resolveFailedResourceLabels = ({summaries}) => {
  if (!summaries) return [];

  return Object.values(HHAX_SYNC_RESOURCES)
    .filter((resource) => {
      const summary = summaries[resource.summaryKey];

      // No summary means it never ran, which is not the same as failing.
      return summary && !summary.succeeded;
    })
    .map((resource) => resource.label);
};

module.exports = class HhaSyncReportingServices {
  /**
   * Record and announce the outcome of one run.
   *
   * @param {Object} params
   * @param {string} params.runId - correlates the notification and socket event.
   * @param {string} params.organizationId - the RESOLVED org (see the worker).
   * @param {boolean} params.success
   * @param {Object|null} [params.summaries]
   */
  static async reportSyncOutcome({
    runId,
    organizationId,
    success,
    summaries = null,
  }) {
    const totals = buildSyncTotals({summaries});
    const failedResources = resolveFailedResourceLabels({summaries});

    await HhaSyncReportingServices.announceOutcome({
      runId,
      organizationId,
      success,
      totals,
      failedResources,
    });
  }

  /** A live socket nudge to every admin. */
  static async announceOutcome({
    runId,
    organizationId,
    success,
    totals,
    failedResources,
  }) {
    try {
      const {success: lookupSucceeded, userIds} =
        await UsersServices.getAdminUserIdsForOrganization({organizationId});

      // A failed lookup and an org with no admins are different problems.
      if (!lookupSucceeded) {
        logger.error(
          `[HHA Sync] could not resolve admins to notify for run ${runId}`
        );

        return;
      }

      if (!userIds.length) {
        logger.info(`[HHA Sync] no admins to notify for run ${runId}`);

        return;
      }

      // Per-user rooms: there is no role room, and the org room holds nurses,
      // caregivers and case managers who must not see the integration's state.
      userIds.forEach((userId) => {
        sendPrivateSocketMessage({
          room: `${SOCKET_ROOM_PREFIXES.USER.value}${userId}`,
          event: SOCKET_EVENTS.HHA_SYNC_COMPLETED.value,
          data: {runId, success, totals, failedResources},
        });
      });
    } catch (notifyError) {
      logger.error(
        `[HHA Sync] failed to announce outcome for run ${runId}: ${notifyError?.message || notifyError}`
      );
    }
  }
};
