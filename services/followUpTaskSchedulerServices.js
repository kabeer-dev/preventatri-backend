const FollowUpTasksServices = require('./followUpTasksServices');

const {
  FOLLOW_UP_TASK_STATUSES,
  FOLLOW_UP_TASK_EVENT_TYPES,
} = require('../constants/followUpTasksConstants');

const {
  NOTIFICATION_TEMPLATE_KEYS,
} = require('../constants/notificationConstants');

const {getCurrentTime} = require('../utils/dateUtils');
const {recordTaskEvent} = require('../utils/followUpTaskEventUtils');

const {
  notifyTaskEvent,
  getAssigneeUserId,
} = require('../utils/followUpTaskNotificationUtils');

const {
  runOverdueSweep,
  runReminderSweep,
} = require('../utils/workItemSweepUtils');

const recordEvent = ({item, ...rest}) =>
  recordTaskEvent(Object.assign({task: item}, rest));

/**
 * The follow-up task sweeps, composed from the shared work-item sweeps: which
 * rows to pick, how to flip them and whom to tell.
 */
module.exports = class FollowUpTaskSchedulerServices {
  // Past-due PENDING -> OVERDUE, handed to the org admin, everyone
  // involved notified.
  static processOverdueTasks({now = getCurrentTime()} = {}) {
    return runOverdueSweep({
      findCandidates: ({now: at}) =>
        FollowUpTasksServices.findOverdueCandidates({now: at}),
      markOverdue: ({id, assigneeUserOrganizationId, now: at, tx}) =>
        FollowUpTasksServices.markOverdue({
          id,
          assigneeUserOrganizationId,
          now: at,
          tx,
        }),
      recordEvent,
      eventTypes: FOLLOW_UP_TASK_EVENT_TYPES,
      overdueStatus: FOLLOW_UP_TASK_STATUSES.overdue.value,
      notify: ({item, toAssignee, admin, adminIds}) =>
        this.notifyOverdue({task: item, toAssignee, admin, adminIds}),
      logLabel: 'FollowUp Overdue',
      now,
    });
  }

  static async notifyOverdue({task, toAssignee, admin, adminIds}) {
    const reassigned = toAssignee !== task.assigneeUserOrganizationId;

    // The admin now holding the task gets the "assigned to you" copy instead.
    const overdueRecipients = [getAssigneeUserId({task}), task.createdBy]
      .concat(adminIds || [])
      .filter((userId) => !(reassigned && userId === admin.userId));

    await notifyTaskEvent({
      templateKey: NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_OVERDUE,
      task,
      recipientIds: overdueRecipients,
    });

    if (reassigned)
      await notifyTaskEvent({
        templateKey:
          NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_ESCALATED_TO_ADMIN,
        task,
        recipientIds: [admin.userId],
      });
  }

  static processReminders({now = getCurrentTime()} = {}) {
    return runReminderSweep({
      findCandidates: ({now: at, offsetMinutes}) =>
        FollowUpTasksServices.findReminderCandidates({
          now: at,
          offsetMinutes,
        }),
      claim: ({id, offsetMinutes, tx}) =>
        FollowUpTasksServices.markReminderSent({id, offsetMinutes, tx}),
      recordEvent,
      eventTypes: FOLLOW_UP_TASK_EVENT_TYPES,
      getDueAt: ({item}) => item.dueAt,
      notify: ({item, hoursLeft}) =>
        notifyTaskEvent({
          templateKey: NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_REMINDER,
          task: item,
          recipientIds: [getAssigneeUserId({task: item})],
          context: {hoursLeft},
        }),
      logLabel: 'FollowUp Reminder',
      now,
    });
  }
};
