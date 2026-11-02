const {SYSTEM_ROLES} = require('./usersConstants');

const SUPERVISORY_VISIT_STATUSES = {
  scheduled: {value: 'SCHEDULED', label: 'Scheduled'},
  overdue: {value: 'OVERDUE', label: 'Overdue'},
  underReview: {value: 'UNDER_REVIEW', label: 'Under review'},
  approved: {value: 'APPROVED', label: 'Approved'},
  cancelled: {value: 'CANCELLED', label: 'Cancelled'},
};

const SUPERVISORY_VISIT_STATUS_VALUES = Object.values(
  SUPERVISORY_VISIT_STATUSES
).map((s) => s.value);

// The visit can still be edited, filed or rescheduled.
const SUPERVISORY_VISIT_OPEN_STATUS_VALUES = [
  SUPERVISORY_VISIT_STATUSES.scheduled.value,
  SUPERVISORY_VISIT_STATUSES.overdue.value,
];

// Statuses the nightly sweep flips to OVERDUE. OVERDUE itself is excluded so a
// visit is escalated to the admin exactly once.
const SUPERVISORY_VISIT_SWEEPABLE_STATUS_VALUES = [
  SUPERVISORY_VISIT_STATUSES.scheduled.value,
];

const SUPERVISORY_VISIT_CANCELLABLE_STATUS_VALUES = [
  SUPERVISORY_VISIT_STATUSES.scheduled.value,
  SUPERVISORY_VISIT_STATUSES.overdue.value,
  SUPERVISORY_VISIT_STATUSES.underReview.value,
];

const SUPERVISORY_VISIT_REVIEWABLE_STATUS_VALUES = [
  SUPERVISORY_VISIT_STATUSES.underReview.value,
];

// PREVENT-772: reopen removed for now; uncomment to restore.
// const SUPERVISORY_VISIT_REOPENABLE_STATUS_VALUES = [
//   SUPERVISORY_VISIT_STATUSES.approved.value,
//   SUPERVISORY_VISIT_STATUSES.cancelled.value,
// ];

const SUPERVISORY_VISIT_TYPES = {
  routine: {value: 'ROUTINE', label: 'Routine'},
  triggered: {value: 'TRIGGERED', label: 'Triggered by alert'},
  other: {value: 'OTHER', label: 'Other'},
};

const SUPERVISORY_VISIT_TYPE_VALUES = Object.values(
  SUPERVISORY_VISIT_TYPES
).map((t) => t.value);

const SUPERVISORY_VISIT_COMPLETION_OUTCOMES = {
  noConcerns: {value: 'NO_CONCERNS', label: 'No concerns'},
  concernsNoted: {value: 'CONCERNS_NOTED', label: 'Concerns noted'},
  notConducted: {value: 'NOT_CONDUCTED', label: 'Could not conduct'},
};

const SUPERVISORY_VISIT_COMPLETION_OUTCOME_VALUES = Object.values(
  SUPERVISORY_VISIT_COMPLETION_OUTCOMES
).map((o) => o.value);

const SUPERVISORY_VISIT_SOURCES = {
  alert: {value: 'ALERT', label: 'Alert'},
  standalone: {value: 'STANDALONE', label: 'Standalone'},
};

// Who may perform a visit; caregivers are only ever "present".
const SUPERVISORY_VISIT_ASSIGNABLE_ROLES = [
  SYSTEM_ROLES.admin.value,
  SYSTEM_ROLES.nurse.value,
  SYSTEM_ROLES.case_manager.value,
];

const SUPERVISORY_VISIT_CAREGIVER_ROLES = [SYSTEM_ROLES.caregiver.value];

const SUPERVISORY_VISIT_EVENT_TYPES = {
  created: {value: 'CREATED', label: 'Visit scheduled'},
  reassigned: {value: 'REASSIGNED', label: 'Reassigned'},
  edited: {value: 'EDITED', label: 'Visit edited'},
  becameOverdue: {value: 'BECAME_OVERDUE', label: 'Became overdue'},
  escalatedToAdmin: {
    value: 'ESCALATED_TO_ADMIN',
    label: 'Escalated to org administrator',
  },
  reminderSent: {value: 'REMINDER_SENT', label: 'Reminder sent'},
  filed: {value: 'FILED', label: 'Filed for review'},
  approved: {value: 'APPROVED', label: 'Visit approved'},
  correctionRequested: {
    value: 'CORRECTION_REQUESTED',
    label: 'Correction requested',
  },
  cancelled: {value: 'CANCELLED', label: 'Visit cancelled'},
  reopened: {value: 'REOPENED', label: 'Visit reopened'},
  followUpsCreated: {
    value: 'FOLLOW_UPS_CREATED',
    label: 'Follow-up tasks created',
  },
};

const SUPERVISORY_VISIT_SORT_FIELDS = {
  createdAt: {value: 'createdAt', searchValue: 'createdAt'},
  scheduledStartAt: {
    value: 'scheduledStartAt',
    searchValue: 'scheduledStartAt',
  },
  status: {value: 'status', searchValue: 'status'},
  visitType: {value: 'visitType', searchValue: 'visitType'},
};

const SUPERVISORY_VISIT_SORT_FIELDS_VALUES = Object.values(
  SUPERVISORY_VISIT_SORT_FIELDS
).map((f) => f.value);

// The list shows the newest visits first, like follow-up tasks.
const SUPERVISORY_VISIT_DEFAULT_SORT = {createdAt: 'desc'};

// Sweeps and "due today" work nearest-scheduled first.
const SUPERVISORY_VISIT_SCHEDULE_SORT = {scheduledStartAt: 'asc'};

const SUPERVISORY_VISIT_COMPLETION_SOURCES = {
  answerSubmitted: {
    value: 'ANSWER_SUBMITTED',
    label: 'Filed with checklist answers',
  },
};

const SUPERVISORY_VISIT_COMPLETION_SOURCE_VALUES = Object.values(
  SUPERVISORY_VISIT_COMPLETION_SOURCES
).map((source) => source.value);

// Escalation-created visits get a one-hour window starting at this time
// (Eastern) on the chosen date when the resolver gives no explicit window.
const SUPERVISORY_VISIT_DEFAULT_START_TIME = '09:00';
const SUPERVISORY_VISIT_DEFAULT_DURATION_MINUTES = 60;

const SUPERVISORY_VISIT_MAX_CAREGIVERS = 20;
const SUPERVISORY_VISIT_MAX_QUEUED_FOLLOW_UPS = 10;
const SUPERVISORY_VISIT_TYPE_OTHER_MAX_LENGTH = 200;
const SUPERVISORY_VISIT_REVIEW_NOTE_MAX_LENGTH = 2000;

module.exports = {
  SUPERVISORY_VISIT_STATUSES,
  SUPERVISORY_VISIT_STATUS_VALUES,
  SUPERVISORY_VISIT_OPEN_STATUS_VALUES,
  SUPERVISORY_VISIT_SWEEPABLE_STATUS_VALUES,
  SUPERVISORY_VISIT_CANCELLABLE_STATUS_VALUES,
  SUPERVISORY_VISIT_REVIEWABLE_STATUS_VALUES,

  // SUPERVISORY_VISIT_REOPENABLE_STATUS_VALUES,
  SUPERVISORY_VISIT_TYPES,
  SUPERVISORY_VISIT_TYPE_VALUES,
  SUPERVISORY_VISIT_COMPLETION_OUTCOMES,
  SUPERVISORY_VISIT_COMPLETION_OUTCOME_VALUES,
  SUPERVISORY_VISIT_SOURCES,
  SUPERVISORY_VISIT_ASSIGNABLE_ROLES,
  SUPERVISORY_VISIT_CAREGIVER_ROLES,
  SUPERVISORY_VISIT_EVENT_TYPES,
  SUPERVISORY_VISIT_SORT_FIELDS,
  SUPERVISORY_VISIT_SORT_FIELDS_VALUES,
  SUPERVISORY_VISIT_DEFAULT_SORT,
  SUPERVISORY_VISIT_SCHEDULE_SORT,
  SUPERVISORY_VISIT_COMPLETION_SOURCES,
  SUPERVISORY_VISIT_COMPLETION_SOURCE_VALUES,
  SUPERVISORY_VISIT_DEFAULT_START_TIME,
  SUPERVISORY_VISIT_DEFAULT_DURATION_MINUTES,
  SUPERVISORY_VISIT_MAX_CAREGIVERS,
  SUPERVISORY_VISIT_MAX_QUEUED_FOLLOW_UPS,
  SUPERVISORY_VISIT_TYPE_OTHER_MAX_LENGTH,
  SUPERVISORY_VISIT_REVIEW_NOTE_MAX_LENGTH,
};
