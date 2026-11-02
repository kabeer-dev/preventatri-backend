const {findEscalationEvent} = require('./followUpTaskHistoryUtils');

const {
  createEventNotifier,
  getAssigneeUserId,
} = require('./workItemNotificationUtils');

const {
  NOTIFICATION_DOCUMENT_TYPES,
} = require('../constants/notificationConstants');

const notify = createEventNotifier({
  documentType: NOTIFICATION_DOCUMENT_TYPES.FOLLOW_UP_TASK.value,
  logLabel: 'FollowUpTask',
});

module.exports.getAssigneeUserId = ({task}) => getAssigneeUserId({item: task});

module.exports.getOriginalAssigneeUserId = ({task}) =>
  findEscalationEvent({task})?.fromAssignee?.user?.id || null;

// Keeps the `task` name callers use; everything else passes through.
module.exports.notifyTaskEvent = ({task, ...rest}) =>
  notify(Object.assign({item: task}, rest));
