const SupervisoryVisitsServices = require('./supervisoryVisitsServices');

const {
  NOTIFICATION_TEMPLATE_KEYS,
} = require('../constants/notificationConstants');

const {
  SUPERVISORY_VISIT_STATUSES,
  SUPERVISORY_VISIT_EVENT_TYPES,
} = require('../constants/supervisoryVisitsConstants');

const {getCurrentTime} = require('../utils/dateUtils');
const {recordVisitEvent} = require('../utils/supervisoryVisitEventUtils');

const {
  notifyVisitEvent,
  getAssigneeUserId,
  getVisitCaregiverUserIds,
} = require('../utils/supervisoryVisitNotificationUtils');

const {
  runOverdueSweep,
  runReminderSweep,
} = require('../utils/workItemSweepUtils');

const recordEvent = ({item, ...rest}) =>
  recordVisitEvent(Object.assign({visit: item}, rest));

/**
 * The supervisory visit sweeps, composed from the shared work-item sweeps: a
 * visit nobody performed is handed to the org admin, and everyone taking
 * part is reminded before it starts.
 */
module.exports = class SupervisoryVisitSchedulerServices {
  // Past-window SCHEDULED -> OVERDUE, handed to the org admin, everyone
  // involved notified.
  static processOverdueVisits({now = getCurrentTime()} = {}) {
    return runOverdueSweep({
      findCandidates: ({now: at}) =>
        SupervisoryVisitsServices.findOverdueCandidates({now: at}),
      markOverdue: ({id, assigneeUserOrganizationId, now: at, tx}) =>
        SupervisoryVisitsServices.markOverdue({
          id,
          assigneeUserOrganizationId,
          now: at,
          tx,
        }),
      recordEvent,
      eventTypes: SUPERVISORY_VISIT_EVENT_TYPES,
      overdueStatus: SUPERVISORY_VISIT_STATUSES.overdue.value,
      notify: ({item, toAssignee, admin, adminIds}) =>
        this.notifyOverdue({visit: item, toAssignee, admin, adminIds}),
      logLabel: 'Visit Overdue',
      now,
    });
  }

  static async notifyOverdue({visit, toAssignee, admin, adminIds}) {
    const reassigned = toAssignee !== visit.assigneeUserOrganizationId;

    // The admin now holding the visit gets the "assigned to you" copy instead.
    const overdueRecipients = [getAssigneeUserId({visit}), visit.createdBy]
      .concat(getVisitCaregiverUserIds({visit}), adminIds || [])
      .filter((userId) => !(reassigned && userId === admin.userId));

    await notifyVisitEvent({
      templateKey: NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_OVERDUE,
      visit,
      recipientIds: overdueRecipients,
    });

    if (reassigned)
      await notifyVisitEvent({
        templateKey:
          NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_ESCALATED_TO_ADMIN,
        visit,
        recipientIds: [admin.userId],
      });
  }

  static processVisitReminders({now = getCurrentTime()} = {}) {
    return runReminderSweep({
      findCandidates: ({now: at, offsetMinutes}) =>
        SupervisoryVisitsServices.findReminderCandidates({
          now: at,
          offsetMinutes,
        }),
      claim: ({id, offsetMinutes, tx}) =>
        SupervisoryVisitsServices.markReminderSent({id, offsetMinutes, tx}),
      recordEvent,
      eventTypes: SUPERVISORY_VISIT_EVENT_TYPES,
      getDueAt: ({item}) => item.scheduledStartAt,
      notify: ({item, hoursLeft}) =>
        notifyVisitEvent({
          templateKey: NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_REMINDER,
          visit: item,
          recipientIds: [getAssigneeUserId({visit: item})].concat(
            getVisitCaregiverUserIds({visit: item})
          ),
          context: {hoursLeft},
        }),
      logLabel: 'Visit Reminder',
      now,
    });
  }
};
