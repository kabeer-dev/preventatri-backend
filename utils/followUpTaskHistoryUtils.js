const {findEscalationEvent} = require('./workItemHistoryUtils');

const {
  FOLLOW_UP_TASK_EVENT_TYPES,
} = require('../constants/followUpTasksConstants');

module.exports.findEscalationEvent = ({task}) =>
  findEscalationEvent({
    item: task,
    escalationEventType: FOLLOW_UP_TASK_EVENT_TYPES.escalatedToAdmin.value,
  });
