const {
  findEscalationEvent,
  getOriginalAssigneeUserId,
} = require('./workItemHistoryUtils');

const {
  SUPERVISORY_VISIT_EVENT_TYPES,
} = require('../constants/supervisoryVisitsConstants');

const ESCALATION_EVENT_TYPE =
  SUPERVISORY_VISIT_EVENT_TYPES.escalatedToAdmin.value;

module.exports.findEscalationEvent = ({visit}) =>
  findEscalationEvent({
    item: visit,
    escalationEventType: ESCALATION_EVENT_TYPE,
  });

module.exports.getOriginalAssigneeUserId = ({visit}) =>
  getOriginalAssigneeUserId({
    item: visit,
    escalationEventType: ESCALATION_EVENT_TYPE,
  });
