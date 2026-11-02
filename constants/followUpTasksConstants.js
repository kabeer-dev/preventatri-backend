const {SYSTEM_ROLES} = require('./usersConstants');

const {
  WORK_ITEM_ACTOR_TYPES,
  WORK_ITEM_CARE_TEAM_ROLES,
  WORK_ITEM_REMINDER_OFFSETS_MINUTES,
  WORK_ITEM_DEFAULT_TIME_ZONE,
  WORK_ITEM_CRON,
  WORK_ITEM_TEXT_MAX_LENGTH,
  WORK_ITEM_CANCEL_REASON_MAX_LENGTH,
  WORK_ITEM_EVENTS_LIMIT,
  WORK_ITEM_EVIDENCE_FIELD_NAME,
  WORK_ITEM_ANSWER_FILE_FIELD_PREFIXES,
} = require('./workItemConstants');

const FOLLOW_UP_TASK_STATUSES = {
  pending: {value: 'PENDING', label: 'Pending'},
  overdue: {value: 'OVERDUE', label: 'Overdue'},
  completed: {value: 'COMPLETED', label: 'Completed'},
  cancelled: {value: 'CANCELLED', label: 'Cancelled'},
};

const FOLLOW_UP_TASK_STATUS_VALUES = Object.values(FOLLOW_UP_TASK_STATUSES).map(
  (s) => s.value
);

// A task can still be worked on (steps, edit, complete, cancel).
const FOLLOW_UP_TASK_OPEN_STATUS_VALUES = [
  FOLLOW_UP_TASK_STATUSES.pending.value,
  FOLLOW_UP_TASK_STATUSES.overdue.value,
];

// PREVENT-772: reopen removed for now; uncomment to restore.
// const FOLLOW_UP_TASK_REOPENABLE_STATUS_VALUES = [
//   FOLLOW_UP_TASK_STATUSES.completed.value,
//   FOLLOW_UP_TASK_STATUSES.cancelled.value,
// ];

// Statuses the nightly sweep flips to OVERDUE. OVERDUE itself is excluded so a
// task is escalated to the admin exactly once.
const FOLLOW_UP_TASK_SWEEPABLE_STATUS_VALUES = [
  FOLLOW_UP_TASK_STATUSES.pending.value,
];

const FOLLOW_UP_TASK_PRIORITIES = {
  low: {value: 'LOW', label: 'Low'},
  normal: {value: 'NORMAL', label: 'Normal'},
  high: {value: 'HIGH', label: 'High'},
};

const FOLLOW_UP_TASK_PRIORITY_VALUES = Object.values(
  FOLLOW_UP_TASK_PRIORITIES
).map((p) => p.value);

const FOLLOW_UP_TASK_DEFAULT_PRIORITY = FOLLOW_UP_TASK_PRIORITIES.normal.value;

const FOLLOW_UP_TASK_FLAG_TYPES = {
  0: {value: 0, label: 'Red Flag'},
  1: {value: 1, label: 'Yellow Flag'},
  2: {value: 2, label: 'Manual'},
};

const FOLLOW_UP_TASK_FLAG_TYPE_VALUES = Object.keys(
  FOLLOW_UP_TASK_FLAG_TYPES
).map(Number);

// Default priority of a task spawned by an escalation resolution, by flag type.
const FLAG_TYPE_TO_DEFAULT_PRIORITY = {
  0: FOLLOW_UP_TASK_PRIORITIES.high.value,
  1: FOLLOW_UP_TASK_PRIORITIES.normal.value,
  2: FOLLOW_UP_TASK_PRIORITIES.normal.value,
};

const FOLLOW_UP_TASK_COMPLETION_OUTCOMES = {
  done: {value: 'DONE', label: 'Done'},
  doneWithIssues: {value: 'DONE_WITH_ISSUES', label: 'Done, with issues'},
  couldNotComplete: {value: 'COULD_NOT_COMPLETE', label: 'Could not complete'},
};

const FOLLOW_UP_TASK_COMPLETION_OUTCOME_VALUES = Object.values(
  FOLLOW_UP_TASK_COMPLETION_OUTCOMES
).map((o) => o.value);

const FOLLOW_UP_TASK_SOURCES = {
  alert: {value: 'ALERT', label: 'Alert'},
  supervisoryVisit: {value: 'SUPERVISORY_VISIT', label: 'Supervisory visit'},
  standalone: {value: 'STANDALONE', label: 'Standalone'},
};

const FOLLOW_UP_TASK_SOURCE_VALUES = Object.values(FOLLOW_UP_TASK_SOURCES).map(
  (s) => s.value
);

const FOLLOW_UP_TASK_ASSIGNABLE_ROLES = [
  SYSTEM_ROLES.admin.value,
  SYSTEM_ROLES.nurse.value,
  SYSTEM_ROLES.case_manager.value,
  SYSTEM_ROLES.caregiver.value,
];

// Shared with supervisory visits; kept under the follow-up names for callers.
const FOLLOW_UP_TASK_CARE_TEAM_ROLES = WORK_ITEM_CARE_TEAM_ROLES;
const FOLLOW_UP_TASK_ACTOR_TYPES = WORK_ITEM_ACTOR_TYPES;

const FOLLOW_UP_TASK_EVENT_TYPES = {
  created: {value: 'CREATED', label: 'Task created'},
  reassigned: {value: 'REASSIGNED', label: 'Reassigned'},
  edited: {value: 'EDITED', label: 'Task edited'},
  becameOverdue: {value: 'BECAME_OVERDUE', label: 'Became overdue'},
  escalatedToAdmin: {
    value: 'ESCALATED_TO_ADMIN',
    label: 'Escalated to org administrator',
  },
  reminderSent: {value: 'REMINDER_SENT', label: 'Reminder sent'},
  completed: {value: 'COMPLETED', label: 'Task completed'},
  cancelled: {value: 'CANCELLED', label: 'Task cancelled'},
  reopened: {value: 'REOPENED', label: 'Task reopened'},
};

const FOLLOW_UP_TASK_REMINDER_OFFSETS_MINUTES =
  WORK_ITEM_REMINDER_OFFSETS_MINUTES;

const FOLLOW_UP_TASK_DEFAULT_TIME_ZONE = WORK_ITEM_DEFAULT_TIME_ZONE;

const FOLLOW_UP_TASK_SORT_FIELDS = {
  createdAt: {value: 'createdAt', searchValue: 'createdAt'},
  dueAt: {value: 'dueAt', searchValue: 'dueAt'},
  status: {value: 'status', searchValue: 'status'},
  title: {value: 'title', searchValue: 'title'},
};

const FOLLOW_UP_TASK_SORT_FIELDS_VALUES = Object.values(
  FOLLOW_UP_TASK_SORT_FIELDS
).map((f) => f.value);

// The list shows newest tasks first; sweeps and due-today work nearest-due first.
const FOLLOW_UP_TASK_DEFAULT_SORT = {createdAt: 'desc'};

const FOLLOW_UP_TASK_DUE_FIRST_SORT = {dueAt: 'asc'};

const FOLLOW_UP_TASK_COMPLETION_SOURCES = {
  answerSubmitted: {
    value: 'ANSWER_SUBMITTED',
    label: 'Completed by answers submission',
  },
  replySubmitted: {
    value: 'REPLY_SUBMITTED',
    label: 'Completed by reply submission',
  },
  manualComplete: {
    value: 'MANUAL_COMPLETE',
    label: 'Completed manually',
  },
  outcomeSubmitted: {
    value: 'OUTCOME_SUBMITTED',
    label: 'Completed with outcome',
  },
};

const FOLLOW_UP_TASK_COMPLETION_SOURCE_VALUES = Object.values(
  FOLLOW_UP_TASK_COMPLETION_SOURCES
).map((source) => source.value);

const FOLLOW_UP_TASK_TITLE_MAX_LENGTH = 200;
const FOLLOW_UP_TASK_TEXT_MAX_LENGTH = WORK_ITEM_TEXT_MAX_LENGTH;

const FOLLOW_UP_TASK_CANCEL_REASON_MAX_LENGTH =
  WORK_ITEM_CANCEL_REASON_MAX_LENGTH;
const FOLLOW_UP_TASK_EVENTS_LIMIT = WORK_ITEM_EVENTS_LIMIT;
const FOLLOW_UP_TASK_EVIDENCE_FIELD_NAME = WORK_ITEM_EVIDENCE_FIELD_NAME;

const FOLLOW_UP_TASK_ANSWER_FILE_FIELD_PREFIXES =
  WORK_ITEM_ANSWER_FILE_FIELD_PREFIXES;
const FOLLOW_UP_TASK_CRON = WORK_ITEM_CRON;

module.exports = {
  FOLLOW_UP_TASK_STATUSES,
  FOLLOW_UP_TASK_STATUS_VALUES,
  FOLLOW_UP_TASK_OPEN_STATUS_VALUES,

  // FOLLOW_UP_TASK_REOPENABLE_STATUS_VALUES,
  FOLLOW_UP_TASK_SWEEPABLE_STATUS_VALUES,
  FOLLOW_UP_TASK_PRIORITIES,
  FOLLOW_UP_TASK_PRIORITY_VALUES,
  FOLLOW_UP_TASK_DEFAULT_PRIORITY,
  FOLLOW_UP_TASK_FLAG_TYPES,
  FOLLOW_UP_TASK_FLAG_TYPE_VALUES,
  FLAG_TYPE_TO_DEFAULT_PRIORITY,
  FOLLOW_UP_TASK_COMPLETION_OUTCOMES,
  FOLLOW_UP_TASK_COMPLETION_OUTCOME_VALUES,
  FOLLOW_UP_TASK_SOURCES,
  FOLLOW_UP_TASK_SOURCE_VALUES,
  FOLLOW_UP_TASK_ASSIGNABLE_ROLES,
  FOLLOW_UP_TASK_CARE_TEAM_ROLES,
  FOLLOW_UP_TASK_ACTOR_TYPES,
  FOLLOW_UP_TASK_EVENT_TYPES,
  FOLLOW_UP_TASK_REMINDER_OFFSETS_MINUTES,
  FOLLOW_UP_TASK_DEFAULT_TIME_ZONE,
  FOLLOW_UP_TASK_SORT_FIELDS,
  FOLLOW_UP_TASK_SORT_FIELDS_VALUES,
  FOLLOW_UP_TASK_DEFAULT_SORT,
  FOLLOW_UP_TASK_DUE_FIRST_SORT,
  FOLLOW_UP_TASK_COMPLETION_SOURCES,
  FOLLOW_UP_TASK_COMPLETION_SOURCE_VALUES,
  FOLLOW_UP_TASK_TITLE_MAX_LENGTH,
  FOLLOW_UP_TASK_TEXT_MAX_LENGTH,
  FOLLOW_UP_TASK_CANCEL_REASON_MAX_LENGTH,
  FOLLOW_UP_TASK_EVENTS_LIMIT,
  FOLLOW_UP_TASK_EVIDENCE_FIELD_NAME,
  FOLLOW_UP_TASK_ANSWER_FILE_FIELD_PREFIXES,
  FOLLOW_UP_TASK_CRON,
};
