const SOCKET_EVENTS = {
  ESCALATION_RED_FLAG: {value: 'escalation:red-flag'},
  ASSIGNED_RED_FLAG: {value: 'assigned:red-flag'},

  // Emitted to the recipient's `user:<id>` room whenever an in-app notification
  // is saved, so the client can refetch / toast in real time.
  NOTIFICATION_NEW: {value: 'notification:new'},

  // Emitted to every admin's room when a sync run finishes. One event with a
  // `success` flag, since the client does the same work either way.
  HHA_SYNC_COMPLETED: {value: 'hha-sync:completed'},
};

const SOCKET_ROOM_PREFIXES = {
  USER: {value: 'user:'},
};

const SOCKET_EVENTS_VALUES = Object.values(SOCKET_EVENTS).map((e) => e.value);

module.exports = {
  SOCKET_ROOM_PREFIXES,
  SOCKET_EVENTS,
  SOCKET_EVENTS_VALUES,
};
