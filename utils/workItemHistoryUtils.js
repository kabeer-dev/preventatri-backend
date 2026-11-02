// Pure helpers over a work item's loaded `events`; safe to require from
// response factories (no services, no factories).

// The ESCALATED_TO_ADMIN event (details only) names who the sweep took the
// item from; null when never escalated or when events aren't loaded.
module.exports.findEscalationEvent = ({item, escalationEventType}) =>
  (item?.events || []).find((event) => event.type === escalationEventType) ||
  null;

module.exports.getOriginalAssigneeUserId = ({item, escalationEventType}) =>
  module.exports.findEscalationEvent({item, escalationEventType})?.fromAssignee
    ?.user?.id || null;
