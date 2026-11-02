// Distinguishes who triggered a notification. SYSTEM => performedBy is null
// (automated/cron events); USER => performedBy holds the actor's user id.
const NOTIFICATION_PERFORMER_TYPES = {
  USER: {value: 'USER'},
  SYSTEM: {value: 'SYSTEM'},
};

const NOTIFICATION_PERFORMER_TYPES_VALUES = Object.values(
  NOTIFICATION_PERFORMER_TYPES
).map((type) => type.value);

// Routing target of a notification — which details page the frontend opens on
// click. Paired with documentId (the target record's id): FLAG → a
// SubmissionFlag, FOLLOW_UP_TASK → a FollowUpTask, SUPERVISORY_VISIT → a
// SupervisoryVisit. Mirrors the Prisma NotificationDocumentType enum.
const NOTIFICATION_DOCUMENT_TYPES = {
  FLAG: {value: 'FLAG'},
  FOLLOW_UP_TASK: {value: 'FOLLOWUPTASK'},
  SUPERVISORY_VISIT: {value: 'SUPERVISORYVISIT'},
};

const NOTIFICATION_DOCUMENT_TYPES_VALUES = Object.values(
  NOTIFICATION_DOCUMENT_TYPES
).map((type) => type.value);

// Delivery channels a notification can fan out to. IN_APP is the persisted row +
// socket toast; EMAIL and SMS are the external channels sent by the delivery
// worker. Callers pass a subset to restrict where a given notification goes
// (e.g. the case-manager overseer copy is in-app only at the primary-nurse tier).
// Channels are additionally gated by the org-wide email/SMS config toggles and by
// the recipient having an email/phone on file.
const NOTIFICATION_CHANNELS = {
  IN_APP: 'IN_APP',
  EMAIL: 'EMAIL',
  SMS: 'SMS',
};

// Default: every channel. Existing call sites that don't specify channels keep
// the pre-existing behavior (in-app + email + SMS).
const ALL_NOTIFICATION_CHANNELS = Object.values(NOTIFICATION_CHANNELS);

// The channels sent outside the app by the delivery worker; each gets its own
// delivery status on the notification row.
const EXTERNAL_NOTIFICATION_CHANNELS = [
  NOTIFICATION_CHANNELS.EMAIL,
  NOTIFICATION_CHANNELS.SMS,
];

// Outcome of one external channel (email / SMS) for a notification. Mirrors the
// Prisma NotificationDeliveryStatus enum.
//   PENDING                      - queued, the worker hasn't finished it yet
//   SENT                         - the provider accepted the message
//   FAILED                       - the send was attempted and errored
//   BLOCKED_IN_ESCALATION_POLICY - the admin removed the channel from the policy step
//   NOT_IN_WORKING_HOURS         - non-critical and outside the org's working hours
//   NOT_REQUESTED                - the caller didn't ask for this channel
//   DISABLED                     - the system-wide email/SMS toggle is off
//   NO_CONTACT                   - the recipient has no phone / email on file
const NOTIFICATION_DELIVERY_STATUSES = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  BLOCKED_IN_ESCALATION_POLICY: 'BLOCKED_IN_ESCALATION_POLICY',
  NOT_IN_WORKING_HOURS: 'NOT_IN_WORKING_HOURS',
  NOT_REQUESTED: 'NOT_REQUESTED',
  DISABLED: 'DISABLED',
  NO_CONTACT: 'NO_CONTACT',
};

const NOTIFICATION_DELIVERY_STATUSES_VALUES = Object.values(
  NOTIFICATION_DELIVERY_STATUSES
);

// How a delivery outcome reads in the activity log; the statuses the delivery
// worker never sets are missing on purpose.
const NOTIFICATION_DELIVERY_AUDIT_LABELS = {
  [NOTIFICATION_DELIVERY_STATUSES.SENT]: 'Sent',
  [NOTIFICATION_DELIVERY_STATUSES.FAILED]: 'Failed',
  [NOTIFICATION_DELIVERY_STATUSES.DISABLED]: 'Not sent: turned off',
  [NOTIFICATION_DELIVERY_STATUSES.NOT_IN_WORKING_HOURS]:
    'Not sent: outside working hours',
  [NOTIFICATION_DELIVERY_STATUSES.NO_CONTACT]: {
    [NOTIFICATION_CHANNELS.EMAIL]: 'Not sent: no email on file',
    [NOTIFICATION_CHANNELS.SMS]: 'Not sent: no phone number on file',
  },
};

// Keeps a provider error (which can be long) readable in the activity log.
const NOTIFICATION_DELIVERY_AUDIT_ERROR_MAX_LENGTH = 200;

const NOTIFICATION_PRIORITY_INDICATORS = {
  CRITICAL: {value: 'critical'},
  HIGH: {value: 'high'},
  LOW: {value: 'low'},
};

// Central catalog of notification copy. One entry per notification event, keyed
// by NOTIFICATION_TEMPLATE_KEYS. Each entry has a static `title` and a
// `description` builder that receives a context object. Centralizing the copy
// here keeps wording consistent across call sites, avoids duplicated literals,
// and gives a single place to evolve text (or wire i18n) later.
const NOTIFICATION_TEMPLATE_KEYS = {
  // Red-flag escalation lifecycle
  RED_FLAG_ASSIGNED: 'RED_FLAG_ASSIGNED',
  RED_FLAG_ESCALATED_TO_YOU: 'RED_FLAG_ESCALATED_TO_YOU',
  RED_FLAG_ESCALATED_AWAY: 'RED_FLAG_ESCALATED_AWAY',
  RED_FLAG_RESOLVED: 'RED_FLAG_RESOLVED',
  RED_FLAG_VOIDED: 'RED_FLAG_VOIDED',

  // Case-manager overseer copies — the CM is kept informed while the flag sits
  // on a nurse-level assignee (they are not the assignee themselves).
  RED_FLAG_ASSIGNED_CASE_MANAGER: 'RED_FLAG_ASSIGNED_CASE_MANAGER',
  RED_FLAG_ESCALATED_CASE_MANAGER: 'RED_FLAG_ESCALATED_CASE_MANAGER',

  // Follow-up task lifecycle. ASSIGNED / REASSIGNED go to the assignee,
  // UNASSIGNED to the previous assignee, COMPLETED back to the creator, the
  // OVERDUE pair to everyone involved when the nightly sweep escalates a task.
  FOLLOW_UP_TASK_ASSIGNED: 'FOLLOW_UP_TASK_ASSIGNED',
  FOLLOW_UP_TASK_REASSIGNED: 'FOLLOW_UP_TASK_REASSIGNED',
  FOLLOW_UP_TASK_UNASSIGNED: 'FOLLOW_UP_TASK_UNASSIGNED',
  FOLLOW_UP_TASK_UPDATED: 'FOLLOW_UP_TASK_UPDATED',
  FOLLOW_UP_TASK_COMPLETED: 'FOLLOW_UP_TASK_COMPLETED',
  FOLLOW_UP_TASK_CANCELLED: 'FOLLOW_UP_TASK_CANCELLED',
  FOLLOW_UP_TASK_REOPENED: 'FOLLOW_UP_TASK_REOPENED',
  FOLLOW_UP_TASK_OVERDUE: 'FOLLOW_UP_TASK_OVERDUE',
  FOLLOW_UP_TASK_ESCALATED_TO_ADMIN: 'FOLLOW_UP_TASK_ESCALATED_TO_ADMIN',
  FOLLOW_UP_TASK_REMINDER: 'FOLLOW_UP_TASK_REMINDER',

  // Supervisory visit lifecycle — mirrors the follow-up task set above, plus
  // the review step (FILED to reviewers, APPROVED / CORRECTION back to the
  // filer) and CAREGIVER_LISTED to caregivers present.
  SUPERVISORY_VISIT_ASSIGNED: 'SUPERVISORY_VISIT_ASSIGNED',
  SUPERVISORY_VISIT_REASSIGNED: 'SUPERVISORY_VISIT_REASSIGNED',
  SUPERVISORY_VISIT_UNASSIGNED: 'SUPERVISORY_VISIT_UNASSIGNED',
  SUPERVISORY_VISIT_UPDATED: 'SUPERVISORY_VISIT_UPDATED',
  SUPERVISORY_VISIT_CAREGIVER_LISTED: 'SUPERVISORY_VISIT_CAREGIVER_LISTED',
  SUPERVISORY_VISIT_FILED: 'SUPERVISORY_VISIT_FILED',
  SUPERVISORY_VISIT_APPROVED: 'SUPERVISORY_VISIT_APPROVED',
  SUPERVISORY_VISIT_CORRECTION_REQUESTED:
    'SUPERVISORY_VISIT_CORRECTION_REQUESTED',
  SUPERVISORY_VISIT_CANCELLED: 'SUPERVISORY_VISIT_CANCELLED',
  SUPERVISORY_VISIT_REOPENED: 'SUPERVISORY_VISIT_REOPENED',
  SUPERVISORY_VISIT_OVERDUE: 'SUPERVISORY_VISIT_OVERDUE',
  SUPERVISORY_VISIT_ESCALATED_TO_ADMIN: 'SUPERVISORY_VISIT_ESCALATED_TO_ADMIN',
  SUPERVISORY_VISIT_REMINDER: 'SUPERVISORY_VISIT_REMINDER',
};

// Escalations run for both RED and YELLOW flags, so the flag-lifecycle
// templates interpolate the severity label from the `flag` color passed in
// context instead of hardcoding "Red". RED stays the default so call sites
// that only ever deal with red flags (e.g. emergency flags) need no context.
const FLAG_SEVERITY_LABELS = {RED: 'Red', YELLOW: 'Yellow'};

const getFlagLabel = ({flag} = {}) => FLAG_SEVERITY_LABELS[flag] || 'Red';

const getFlagLabelLower = ({flag} = {}) => getFlagLabel({flag}).toLowerCase();

// "for Jane Doe" in-app, "for a patient" on external channels (patientName is
// cleared for the SMS/email copy).
const forPatient = ({patientName} = {}) =>
  patientName ? `for ${patientName}` : 'for a patient';

const NOTIFICATION_TEMPLATES = {
  // Initial assignment when a flag is raised (sent to the first assignee).
  [NOTIFICATION_TEMPLATE_KEYS.RED_FLAG_ASSIGNED]: {
    // Red flags are critical; yellow (any non-red) flags are high priority.
    type: (context) =>
      getFlagLabel(context) === FLAG_SEVERITY_LABELS.RED
        ? NOTIFICATION_PRIORITY_INDICATORS.CRITICAL.value
        : NOTIFICATION_PRIORITY_INDICATORS.HIGH.value,
    title: (context) => `${getFlagLabel(context)} flag assigned`,
    description: (context) =>
      `A ${getFlagLabelLower(context)} flag has been raised and assigned to you.`,
  },

  // Escalation advanced the flag onto the next assignee (sent to that assignee).
  [NOTIFICATION_TEMPLATE_KEYS.RED_FLAG_ESCALATED_TO_YOU]: {
    type: (context) =>
      getFlagLabel(context) === FLAG_SEVERITY_LABELS.RED
        ? NOTIFICATION_PRIORITY_INDICATORS.CRITICAL.value
        : NOTIFICATION_PRIORITY_INDICATORS.HIGH.value,
    title: (context) => `${getFlagLabel(context)} flag escalated to you`,
    description: (context) =>
      `A ${getFlagLabelLower(context)} flag has been escalated and assigned to you.`,
  },

  // Escalation moved the flag off the previous assignee (sent to them).
  [NOTIFICATION_TEMPLATE_KEYS.RED_FLAG_ESCALATED_AWAY]: {
    type: (context) =>
      getFlagLabel(context) === FLAG_SEVERITY_LABELS.RED
        ? NOTIFICATION_PRIORITY_INDICATORS.CRITICAL.value
        : NOTIFICATION_PRIORITY_INDICATORS.HIGH.value,
    title: (context) => `${getFlagLabel(context)} flag escalated`,
    description: (context) =>
      `You did not address a ${getFlagLabelLower(context)} flag in time and it has been escalated from you.`,
  },

  // Escalation resolved (sent to everyone who was alerted during the flag's
  // life plus the resolver). Optional patientName is interpolated when available.
  [NOTIFICATION_TEMPLATE_KEYS.RED_FLAG_RESOLVED]: {
    type: (context) =>
      getFlagLabel(context) === FLAG_SEVERITY_LABELS.RED
        ? NOTIFICATION_PRIORITY_INDICATORS.CRITICAL.value
        : NOTIFICATION_PRIORITY_INDICATORS.HIGH.value,
    title: (context) => `${getFlagLabel(context)} flag resolved`,
    description: ({patientName, flag} = {}) =>
      patientName
        ? `A ${getFlagLabelLower({flag})} flag for ${patientName} has been resolved.`
        : `A ${getFlagLabelLower({flag})} flag for a patient has been resolved.`,
  },

  // Flag voided (sent to everyone who was alerted during the flag's life plus
  // the person who voided it). Optional patientName is interpolated when available.
  [NOTIFICATION_TEMPLATE_KEYS.RED_FLAG_VOIDED]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
    title: (context) => `${getFlagLabel(context)} flag voided`,
    description: ({patientName, flag} = {}) =>
      patientName
        ? `A ${getFlagLabelLower({flag})} flag for ${patientName} has been voided.`
        : `A ${getFlagLabelLower({flag})} flag for a patient has been voided.`,
  },

  // Initial assignment overseer copy (sent to the patient's case manager).
  [NOTIFICATION_TEMPLATE_KEYS.RED_FLAG_ASSIGNED_CASE_MANAGER]: {
    type: (context) =>
      getFlagLabel(context) === FLAG_SEVERITY_LABELS.RED
        ? NOTIFICATION_PRIORITY_INDICATORS.CRITICAL.value
        : NOTIFICATION_PRIORITY_INDICATORS.HIGH.value,
    title: (context) => `${getFlagLabel(context)} flag raised`,
    description: (context) =>
      `A ${getFlagLabelLower(context)} flag has been raised for a patient in your caseload and assigned to a nurse.`,
  },

  // Escalation overseer copy (sent to the patient's case manager) whenever the
  // flag advances to another nurse-level assignee.
  [NOTIFICATION_TEMPLATE_KEYS.RED_FLAG_ESCALATED_CASE_MANAGER]: {
    type: (context) =>
      getFlagLabel(context) === FLAG_SEVERITY_LABELS.RED
        ? NOTIFICATION_PRIORITY_INDICATORS.CRITICAL.value
        : NOTIFICATION_PRIORITY_INDICATORS.HIGH.value,
    title: (context) => `${getFlagLabel(context)} flag escalated`,
    description: (context) =>
      `A ${getFlagLabelLower(context)} flag for a patient in your caseload has been escalated to another nurse.`,
  },

  // Follow-up task assigned to the case manager (on creation / escalation resolve).
  [NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_ASSIGNED]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
    title: 'Follow-up task assigned',
    description: ({patientName} = {}) =>
      patientName
        ? `A follow-up task for ${patientName} has been assigned to you.`
        : 'A follow-up task for a patient has been assigned to you.',
  },

  // Follow-up task completed (sent to whoever created it).
  [NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_COMPLETED]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
    title: 'Follow-up task completed',
    description: ({patientName} = {}) =>
      patientName
        ? `A follow-up task you created for ${patientName} has been completed.`
        : 'A follow-up task you created for a patient has been completed.',
  },

  [NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_REASSIGNED]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
    title: 'Follow-up task reassigned to you',
    description: (context) =>
      `A follow-up task ${forPatient(context)} has been reassigned to you.`,
  },

  [NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_UNASSIGNED]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
    title: 'Follow-up task reassigned',
    description: (context) =>
      `A follow-up task ${forPatient(context)} has been reassigned from you to someone else.`,
  },

  [NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_UPDATED]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
    title: 'Follow-up task updated',
    description: (context) =>
      `A follow-up task ${forPatient(context)} assigned to you has been updated.`,
  },

  [NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_CANCELLED]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
    title: 'Follow-up task cancelled',
    description: (context) =>
      `A follow-up task ${forPatient(context)} has been cancelled.`,
  },

  [NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_REOPENED]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
    title: 'Follow-up task reopened',
    description: (context) =>
      `A follow-up task ${forPatient(context)} has been reopened.`,
  },

  // Nightly sweep: original assignee, creator and every org admin.
  [NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_OVERDUE]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.HIGH.value,
    title: 'Follow-up task overdue',
    description: (context) =>
      `A follow-up task ${forPatient(context)} was not completed by its due time and has been escalated to the organization administrator.`,
  },

  // Nightly sweep: the admin the task now belongs to.
  [NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_ESCALATED_TO_ADMIN]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.HIGH.value,
    title: 'Overdue follow-up task assigned to you',
    description: (context) =>
      `An overdue follow-up task ${forPatient(context)} has been escalated and assigned to you.`,
  },

  [NOTIFICATION_TEMPLATE_KEYS.FOLLOW_UP_TASK_REMINDER]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
    title: ({hoursLeft} = {}) => `Follow-up task due in ${hoursLeft} hours`,
    description: (context) =>
      `A follow-up task ${forPatient(context)} assigned to you is due in ${context?.hoursLeft} hours.`,
  },

  // Supervisory visit assigned (on creation / escalation resolve).
  [NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_ASSIGNED]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.CRITICAL.value,
    title: 'Supervisory visit assigned',
    description: (context) =>
      `A supervisory visit ${forPatient(context)} has been assigned to you.`,
  },

  [NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_REASSIGNED]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.HIGH.value,
    title: 'Supervisory visit reassigned to you',
    description: (context) =>
      `A supervisory visit ${forPatient(context)} has been reassigned to you.`,
  },

  [NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_UNASSIGNED]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
    title: 'Supervisory visit reassigned',
    description: (context) =>
      `A supervisory visit ${forPatient(context)} has been reassigned from you to someone else.`,
  },

  [NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_UPDATED]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
    title: 'Supervisory visit updated',
    description: (context) =>
      `A supervisory visit ${forPatient(context)} you are part of has been updated.`,
  },

  // Caregivers present are told when they are added to a visit.
  [NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_CAREGIVER_LISTED]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
    title: 'You are listed on a supervisory visit',
    description: (context) =>
      `You have been listed as present for a supervisory visit ${forPatient(context)}.`,
  },

  // Filed by the assignee: reviewers (admins + the patient's case manager).
  [NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_FILED]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.HIGH.value,
    title: 'Supervisory visit awaiting review',
    description: (context) =>
      `A supervisory visit ${forPatient(context)} has been filed and is waiting for your review.`,
  },

  [NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_APPROVED]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
    title: 'Supervisory visit approved',
    description: (context) =>
      `A supervisory visit ${forPatient(context)} has been approved.`,
  },

  [NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_CORRECTION_REQUESTED]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.HIGH.value,
    title: 'Supervisory visit sent back for correction',
    description: (context) =>
      `A supervisory visit ${forPatient(context)} you filed needs corrections before it can be approved.`,
  },

  [NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_CANCELLED]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
    title: 'Supervisory visit cancelled',
    description: (context) =>
      `A supervisory visit ${forPatient(context)} has been cancelled.`,
  },

  [NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_REOPENED]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
    title: 'Supervisory visit reopened',
    description: (context) =>
      `A supervisory visit ${forPatient(context)} has been reopened.`,
  },

  // Nightly sweep: original assignee, creator, caregivers and every org admin.
  [NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_OVERDUE]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.HIGH.value,
    title: 'Supervisory visit overdue',
    description: (context) =>
      `A supervisory visit ${forPatient(context)} was not performed in its scheduled window and has been escalated to the organization administrator.`,
  },

  // Nightly sweep: the admin the visit now belongs to.
  [NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_ESCALATED_TO_ADMIN]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.HIGH.value,
    title: 'Overdue supervisory visit assigned to you',
    description: (context) =>
      `An overdue supervisory visit ${forPatient(context)} has been escalated and assigned to you.`,
  },

  [NOTIFICATION_TEMPLATE_KEYS.SUPERVISORY_VISIT_REMINDER]: {
    type: NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
    title: ({hoursLeft} = {}) => `Supervisory visit in ${hoursLeft} hours`,
    description: (context) =>
      `A supervisory visit ${forPatient(context)} you are part of starts in ${context?.hoursLeft} hours.`,
  },
};

// Fields the notifications list endpoint can sort by. Keyed by the query value
// with a `searchValue` (the Prisma column) for buildOrderByClause.
const NOTIFICATION_SORT_FIELDS = {
  createdAt: {value: 'createdAt', searchValue: 'createdAt'},
  readAt: {value: 'readAt', searchValue: 'readAt'},
};

const NOTIFICATION_SORT_FIELDS_VALUES = Object.values(
  NOTIFICATION_SORT_FIELDS
).map((field) => field.value);

module.exports = {
  NOTIFICATION_PERFORMER_TYPES,
  NOTIFICATION_PERFORMER_TYPES_VALUES,
  NOTIFICATION_DOCUMENT_TYPES,
  NOTIFICATION_DOCUMENT_TYPES_VALUES,
  NOTIFICATION_CHANNELS,
  ALL_NOTIFICATION_CHANNELS,
  EXTERNAL_NOTIFICATION_CHANNELS,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_DELIVERY_STATUSES_VALUES,
  NOTIFICATION_DELIVERY_AUDIT_LABELS,
  NOTIFICATION_DELIVERY_AUDIT_ERROR_MAX_LENGTH,
  NOTIFICATION_TEMPLATE_KEYS,
  NOTIFICATION_TEMPLATES,
  NOTIFICATION_PRIORITY_INDICATORS,
  NOTIFICATION_SORT_FIELDS,
  NOTIFICATION_SORT_FIELDS_VALUES,
};
