const {Prisma} = require('../generated/prisma/client');

const CHECKLIST_TEMPLATE_STATUSES = {
  DRAFT: {value: 'DRAFT', label: 'Draft'},
  ACTIVE: {value: 'ACTIVE', label: 'Active'},
  ARCHIVED: {value: 'ARCHIVED', label: 'Archived'},
};

const CHECKLIST_TEMPLATE_STATUSES_VALUES = Object.values(
  CHECKLIST_TEMPLATE_STATUSES
).map((status) => status.value);

// Target status -> the only status a template may reach it from. One-way on
// purpose: nothing returns to DRAFT and an archived template stays archived.
const CHECKLIST_TEMPLATE_STATUS_TRANSITIONS = {
  [CHECKLIST_TEMPLATE_STATUSES.ACTIVE.value]:
    CHECKLIST_TEMPLATE_STATUSES.DRAFT.value,
  [CHECKLIST_TEMPLATE_STATUSES.ARCHIVED.value]:
    CHECKLIST_TEMPLATE_STATUSES.ACTIVE.value,
};

const CHECKLIST_TEMPLATE_TARGET_STATUSES_VALUES = Object.keys(
  CHECKLIST_TEMPLATE_STATUS_TRANSITIONS
);

// Drafts are an admin's work in progress; every other role only sees these.
const CHECKLIST_TEMPLATE_PUBLISHED_STATUSES_VALUES = [
  CHECKLIST_TEMPLATE_STATUSES.ACTIVE.value,
  CHECKLIST_TEMPLATE_STATUSES.ARCHIVED.value,
];

const CHECKLIST_TEMPLATE_TYPES = {
  PATIENT: {value: 'PATIENT', label: 'Patient Checklist'},
  FOLLOW_UP: {value: 'FOLLOW_UP', label: 'Follow Up Task'},
  SUPERVISORY_VISIT: {value: 'SUPERVISORY_VISIT', label: 'Supervisory Visit'},
};

const CHECKLIST_TEMPLATE_TYPES_VALUES = Object.values(
  CHECKLIST_TEMPLATE_TYPES
).map((type) => type.value);

// Answer option flags and the points each one contributes. Lowercase to match
// the options already stored in the templates JSON. Single source of truth for
// points -- the client sends only the flag.
const CHECKLIST_OPTION_FLAGS = {
  GREEN: {value: 'green', label: 'Green', points: 0},
  YELLOW: {value: 'yellow', label: 'Yellow', points: 5},
  RED: {value: 'red', label: 'Red', points: 20},
};

const CHECKLIST_OPTION_FLAGS_VALUES = Object.values(CHECKLIST_OPTION_FLAGS).map(
  (flag) => flag.value
);

const CHECKLIST_OPTION_FLAG_POINTS = Object.values(
  CHECKLIST_OPTION_FLAGS
).reduce((acc, flag) => Object.assign(acc, {[flag.value]: flag.points}), {});

// Case manager templates are scored by escalation, not by answer points.
const CHECKLIST_TYPES_WITH_SCORED_OPTIONS = [
  CHECKLIST_TEMPLATE_TYPES.PATIENT.value,
];

const CHECKLIST_TEMPLATE_STATUS_FILTER_ALL = 'all';

const CHECKLIST_FIELD_TYPES = {
  TEXTAREA: {value: 'textarea', label: 'Text'},
  NUMBER: {value: 'number', label: 'Number'},
  BOOLEAN: {value: 'boolean', label: 'Yes/No'},
  SELECT: {value: 'select', label: 'Single Select'},
  MULTI_SELECT: {value: 'multiSelect', label: 'Multi Select'},
  DATE: {value: 'date', label: 'Date'},
  CHECKBOX: {value: 'checkbox', label: 'Checkbox'},
};

const CHECKLIST_FIELD_TYPES_VALUES = Object.values(CHECKLIST_FIELD_TYPES).map(
  (type) => type.value
);

const CHECKLIST_CHOICE_FIELD_TYPES_VALUES = [
  CHECKLIST_FIELD_TYPES.SELECT.value,
  CHECKLIST_FIELD_TYPES.MULTI_SELECT.value,
];

const CHECKLIST_TEMPLATES_SORT_FIELDS = {
  title: {value: 'title', searchValue: 'title'},
  status: {value: 'status', searchValue: 'status'},
  type: {value: 'type', searchValue: 'type'},
  createdAt: {value: 'createdAt', searchValue: 'createdAt'},
};

const CHECKLIST_TEMPLATES_SORT_FIELDS_VALUES = Object.values(
  CHECKLIST_TEMPLATES_SORT_FIELDS
).map((field) => field.value);

const CHECKLIST_SUBMISSION_STATUSES = {
  UPCOMING: {value: 'UPCOMING', label: 'Upcoming'},
  PENDING: {value: 'PENDING', label: 'Pending'},
  LATE: {value: 'LATE', label: 'Late'},
  SUBMITTED: {value: 'SUBMITTED', label: 'Submitted'},
  REVIEWED: {value: 'REVIEWED', label: 'Reviewed'},
  MISSED: {value: 'MISSED', label: 'Missed'},
  SKIPPED: {value: 'SKIPPED', label: 'Skipped'},
  VOIDED: {value: 'VOIDED', label: 'Voided'},
};

const CHECKLIST_SUBMISSION_STATUSES_VALUES = Object.values(
  CHECKLIST_SUBMISSION_STATUSES
).map((status) => status.value);

const CHECKLIST_SUBMISSIONS_SORT_FIELDS = {
  submittedAt: {value: 'submittedAt', searchValue: 'submittedAt'},
  status: {value: 'status', searchValue: 'status'},
  dueDate: {value: 'dueDate', searchValue: 'dueDate'},
};

const CHECKLIST_SUBMISSIONS_SORT_FIELDS_VALUES = Object.values(
  CHECKLIST_SUBMISSIONS_SORT_FIELDS
).map((field) => field.value);

const SKIPPABLE_STATUSES = [
  CHECKLIST_SUBMISSION_STATUSES.UPCOMING.value,
  CHECKLIST_SUBMISSION_STATUSES.PENDING.value,
  CHECKLIST_SUBMISSION_STATUSES.LATE.value,
];

const VOIDABLE_STATUSES = [
  CHECKLIST_SUBMISSION_STATUSES.SUBMITTED.value,
  CHECKLIST_SUBMISSION_STATUSES.REVIEWED.value,
  CHECKLIST_SUBMISSION_STATUSES.MISSED.value,
];

// Statuses whose lateness against the due date is reported (still open or already sent).
const LATENESS_TRACKED_STATUSES = [
  CHECKLIST_SUBMISSION_STATUSES.LATE.value,
  CHECKLIST_SUBMISSION_STATUSES.SUBMITTED.value,
  CHECKLIST_SUBMISSION_STATUSES.REVIEWED.value,
];

/**
 * A plain user's memberships with the given person details, so a reader can
 * take the ones of the record's organization (withOrganizationMember). Names
 * and phones are kept per organization, never on the user.
 */
const buildUserMembershipsSelect = ({fields}) => ({
  select: Object.fromEntries(
    ['organizationId'].concat(fields).map((field) => [field, true])
  ),
});

/**
 * Where-clause for a plain user relation matching one search token against
 * the name the person has in the organization, never another one's. Without
 * an organization any of their names matches.
 */
const buildMemberNameWhere = ({token, organizationId}) => ({
  userOrganizations: {
    some: {
      organizationId,
      OR: [
        {firstName: {contains: token, mode: 'insensitive'}},
        {lastName: {contains: token, mode: 'insensitive'}},
      ],
    },
  },
});

// Who scheduled a checklist assignment, as shown on its submissions.
const CHECKLIST_ASSIGNMENT_ASSIGNER_SELECT = {
  select: {
    id: true,
    userOrganizations: buildUserMembershipsSelect({
      fields: ['firstName', 'lastName'],
    }),
  },
};

const SUBMISSION_ATTACHMENT_FILE_SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB

const MAX_ATTACHMENTS_PER_QUESTION = 5;

// Files a nurse may attach while resolving a raised flag (escalation response).
const RESOLUTION_ATTACHMENT_FILE_SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB

const MAX_RESOLUTION_ATTACHMENTS = 5;

// Usage stats run as raw SQL, which skips the automatic org and soft-delete
// filters, so both are spelled out. Enum columns are compared as text because
// bound values arrive untyped.
const CHECKLIST_TEMPLATE_PATIENT_USAGE_SQL = ({
  templateId,
  organizationId,
  countedSubmissionStatuses,
  autoFlagType,
  redFlag,
  voidedFlagStatus,
}) =>
  Prisma.sql`
  WITH assignment_stats AS (
    SELECT
      COUNT(DISTINCT a."caregiverProfileId")::int AS assignees,
      COUNT(DISTINCT a."patientId")::int AS patients
    FROM checklist_assignments a
    WHERE a."checklistTemplateId" = ${templateId}
      AND a."organizationId" = ${organizationId}
      AND a.deleted_at IS NULL
  ),
  submission_stats AS (
    SELECT
      COUNT(*)::int AS total,
      MAX(s."submittedAt") AS "lastActivityAt"
    FROM checklist_submissions s
    WHERE s."checklistTemplateId" = ${templateId}
      AND s."organizationId" = ${organizationId}
      AND s.deleted_at IS NULL
      AND s.status::text = ANY(${countedSubmissionStatuses}::text[])
  ),
  flag_stats AS (
    SELECT COUNT(*)::int AS "redFlags"
    FROM submission_flags f
    JOIN checklist_submissions s ON s.id = f."submissionId"
    WHERE s."checklistTemplateId" = ${templateId}
      AND f."organizationId" = ${organizationId}
      AND f.type::text = ${autoFlagType}
      AND f.flag::text = ${redFlag}
      AND f.status::text <> ${voidedFlagStatus}
      AND f.deleted_at IS NULL
      AND s.deleted_at IS NULL
  )
  SELECT
    assignment_stats.assignees,
    assignment_stats.patients,
    submission_stats.total,
    NULL::int AS completed,
    flag_stats."redFlags",
    submission_stats."lastActivityAt"
  FROM assignment_stats, submission_stats, flag_stats
`;

// Follow-up tasks and supervisory visits share their columns; the table name
// comes from CHECKLIST_TEMPLATE_USAGE_TABLES, never from request input.
const CHECKLIST_TEMPLATE_CASE_MANAGER_USAGE_SQL = ({
  tableName,
  templateId,
  organizationId,
  completedStatus,
}) =>
  Prisma.sql`
  SELECT
    COUNT(DISTINCT t.case_manager_profile_id)::int AS assignees,
    COUNT(DISTINCT t.patient_id)::int AS patients,
    COUNT(*)::int AS total,
    (COUNT(*) FILTER (WHERE t.status = ${completedStatus}))::int AS completed,
    NULL::int AS "redFlags",
    MAX(t.completed_at) AS "lastActivityAt"
  FROM ${Prisma.raw(tableName)} t
  WHERE t.checklist_template_id = ${templateId}
    AND t.organization_id = ${organizationId}
    AND t.deleted_at IS NULL
`;

const CHECKLIST_TEMPLATE_USAGE_TABLES = {
  [CHECKLIST_TEMPLATE_TYPES.FOLLOW_UP.value]: 'follow_up_tasks',
  [CHECKLIST_TEMPLATE_TYPES.SUPERVISORY_VISIT.value]: 'supervisory_visits',
};

module.exports = {
  CHECKLIST_TEMPLATE_STATUSES,
  CHECKLIST_TEMPLATE_STATUSES_VALUES,
  CHECKLIST_TEMPLATE_STATUS_TRANSITIONS,
  CHECKLIST_TEMPLATE_TARGET_STATUSES_VALUES,
  CHECKLIST_TEMPLATE_PUBLISHED_STATUSES_VALUES,
  CHECKLIST_TEMPLATE_TYPES,
  CHECKLIST_TEMPLATE_TYPES_VALUES,
  CHECKLIST_OPTION_FLAGS,
  CHECKLIST_OPTION_FLAGS_VALUES,
  CHECKLIST_OPTION_FLAG_POINTS,
  CHECKLIST_TYPES_WITH_SCORED_OPTIONS,
  CHECKLIST_TEMPLATE_STATUS_FILTER_ALL,
  CHECKLIST_FIELD_TYPES,
  CHECKLIST_FIELD_TYPES_VALUES,
  CHECKLIST_CHOICE_FIELD_TYPES_VALUES,
  CHECKLIST_TEMPLATES_SORT_FIELDS,
  CHECKLIST_TEMPLATES_SORT_FIELDS_VALUES,
  CHECKLIST_SUBMISSION_STATUSES,
  CHECKLIST_SUBMISSION_STATUSES_VALUES,
  SKIPPABLE_STATUSES,
  VOIDABLE_STATUSES,
  LATENESS_TRACKED_STATUSES,
  buildUserMembershipsSelect,
  buildMemberNameWhere,
  CHECKLIST_ASSIGNMENT_ASSIGNER_SELECT,
  CHECKLIST_SUBMISSIONS_SORT_FIELDS,
  CHECKLIST_SUBMISSIONS_SORT_FIELDS_VALUES,
  SUBMISSION_ATTACHMENT_FILE_SIZE_LIMIT,
  MAX_ATTACHMENTS_PER_QUESTION,
  RESOLUTION_ATTACHMENT_FILE_SIZE_LIMIT,
  MAX_RESOLUTION_ATTACHMENTS,
  CHECKLIST_TEMPLATE_PATIENT_USAGE_SQL,
  CHECKLIST_TEMPLATE_CASE_MANAGER_USAGE_SQL,
  CHECKLIST_TEMPLATE_USAGE_TABLES,
};
