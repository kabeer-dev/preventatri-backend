const {CAREGIVER_STATUSES_VALUES} = require('./caregiversConstants');
const {ENTITY_STATUSES_VALUES} = require('./generalConstant');
const {patientScope} = require('./reports/reportSqlFragments');
const {RISK_SCORE_THRESHOLDS} = require('./riskCalcConstants');
const {Prisma} = require('../generated/prisma/client');

const SYSTEM_ROLES = {
  admin: {value: 'admin', label: 'Admin'},
  employee: {value: 'employee', label: 'Employee'},
  nurse: {value: 'nurse', label: 'Nurse'},
  caregiver: {value: 'caregiver', label: 'Caregiver'},
  case_manager: {value: 'case_manager', label: 'Case Manager'},

  // Platform-level. Lives alone in its own seeded organization and manages
  // organizations only; it holds no permission on any organization's data.
  super_admin: {value: 'super_admin', label: 'Super Admin'},
};

const SYSTEM_ROLES_VALUES = Object.values(SYSTEM_ROLES).map(
  (role) => role.value
);

// Roles invitable through POST /users/invite — each one owns a profile schema
// and controller. admin/employee have no profile, so they are not invitable there.
const INVITE_USER_TYPES = [
  SYSTEM_ROLES.nurse.value,
  SYSTEM_ROLES.caregiver.value,
  SYSTEM_ROLES.case_manager.value,
];

const LANGUAGES = {
  english: {value: 'en'},
  dutch: {value: 'nl'},

  // Add more languages as needed
};

const LANGUAGES_VALUES = Object.values(LANGUAGES).map(
  (language) => language.value
);

const DEFAULT_LANGUAGE = LANGUAGES.english.value;

/**
 * User fields that can be updated via updateProfile endpoint
 * Excludes sensitive fields like secretKeys, otps, isDeleted, isVerified
 * Reuse this constant elsewhere to avoid hardcoding field lists
 */
const UPDATABLE_USER_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phoneNo',
  'password',
  'language',
  'address',
  'city',
  'zipCode',
];

/**
 * User fields that should NEVER be user-updatable
 * These are security-sensitive and can only be modified by system/admin operations
 */
const NON_UPDATABLE_USER_FIELDS = [
  'isVerified',
  'isDeleted',
  'secretKeys',
  'otps',
];

// Maximum span (in days) allowed for the statistics time-series window. The
// endpoint is O(days) — one label + query bucket per day — so an unbounded
// range (e.g. a partially-typed year like 0002) would produce a multi-MB
// payload and lock up the chart. Requests exceeding this are rejected.
const MAX_TIMESERIES_RANGE_DAYS = 366;

// Response keys for the admin dashboard Trends payload.
const ADMIN_STATS_TRENDS_METRICS = {
  flagsRaised: 'flagsRaised',
  slaCompliance: 'slaCompliance',
};

// Flag color -> its series key under flagsRaised, in legend order.
const FLAGS_RAISED_SERIES_KEYS = {
  [RISK_SCORE_THRESHOLDS.RED.flag]: 'red',
  [RISK_SCORE_THRESHOLDS.YELLOW.flag]: 'yellow',
  [RISK_SCORE_THRESHOLDS.GREEN.flag]: 'green',
};

// --- Admin dashboard Trends aggregation SQL ---------------------------------
// Every ${...} slot is a bound Prisma parameter, so injection is impossible; never
// build these by string concatenation or pass untrusted values to Prisma.raw().

// createdAt is UTC wall clock: read it as UTC, bucket by the org's day.
// Region is the patient's current county, so green flags still place.
const FLAGS_RAISED_BY_DAY_SQL = ({
  organizationId,
  flags,
  startISO,
  endISO,
  timeZone,
  scope,
}) =>
  Prisma.sql`
  SELECT
    to_char(date_trunc('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}::text), 'YYYY-MM-DD') AS day,
    "flag"::text AS flag,
    COUNT(*)::int AS count
  FROM submission_flags
  WHERE "organizationId" = ${organizationId}
    AND "deleted_at" IS NULL
    AND "flag"::text IN (${Prisma.join(flags)})
    AND ("createdAt" AT TIME ZONE 'UTC') >= ${startISO}::timestamptz
    AND ("createdAt" AT TIME ZONE 'UTC') <  ${endISO}::timestamptz
    ${patientScope({patientIdColumn: '"patientId"', scope})}
  GROUP BY 1, 2
`;

// At risk = an active escalation past the midpoint of its current level's TTL.
// Derived from the row's own timestamps, so per-level TTL changes need no edit here.
const SLA_AT_RISK_COUNT_SQL = ({organizationId, activeStatus}) =>
  Prisma.sql`
  SELECT COUNT(*)::int AS sla_at_risk
  FROM submission_flag_escalations e
  JOIN submission_flags f ON f."id" = e."submission_flag_id"
  WHERE e."organizationId" = ${organizationId}
    AND e."status" = ${activeStatus}
    AND f."deleted_at" IS NULL
    AND e."expires_at" > now()
    AND now() >= e."assigned_at" + (e."expires_at" - e."assigned_at") / 2
`;

// Per-nurse average handling time (seconds), all-time, powering the AVG RESP TIME
// column on the nurses list: nurse-level events the assignee RESOLVED, from
// assigned_at to ended_at, bucketed per assignee and unbounded in time.
//
// No JOIN to submission_flag_escalations: userOrgIds are always resolved within a
// single organization and UserOrganization is unique per (user, organization), so
// membership in the IN-list *is* the org scope.
//
// Column-name trap: `assigneeId` has no @map in schema.prisma, so its physical
// column is camelCase — unlike its snake_cased neighbours assigned_at / ended_at
// (and unlike current_assignee_id on the escalations table). Verified against the
// 20260601000000 migration DDL. Do not "normalize" it to assignee_id; that column
// does not exist.
//
// Only assignees with >= 1 qualifying event appear in the result; the caller
// defaults everyone else to null. Every ${...} slot is a bound Prisma parameter. Callers MUST guard against
// an empty userOrgIds array: Prisma.join([]) throws.
const NURSE_RESPONSE_TIME_BY_ASSIGNEE_SQL = ({
  resolvedAction,
  nurseLevels,
  userOrgIds,
}) =>
  Prisma.sql`
  SELECT
    ev."assigneeId" AS assignee_id,
    AVG(EXTRACT(EPOCH FROM (ev."ended_at" - ev."assigned_at")))::float AS avg_seconds
  FROM submission_flag_escalation_events ev
  WHERE ev."action" = ${resolvedAction}
    AND ev."level"::text IN (${Prisma.join(nurseLevels)})
    AND ev."assigneeId" IN (${Prisma.join(userOrgIds)})
    AND ev."ended_at" IS NOT NULL
  GROUP BY ev."assigneeId"
`;

/**
 * Phone numbers are stored the way HHAeXchange delivers them: digits with an
 * optional leading "+", nothing else, at most 20 characters (users.phoneNo is
 * VarChar(20)). One rule for every role (patients, nurses, caregivers, case
 * managers) and for both manual entry and sync. Formatting characters the
 * phone widget adds (spaces, dashes, brackets) are stripped before validation.
 */
const PHONE_NUMBER_MAX_LENGTH = 20;
const PHONE_NUMBER_PATTERN = /^\+?\d+$/;
const PHONE_NUMBER_STRIP_PATTERN = /[^\d+]/g;

// A login email: the request schemas and the HHAeXchange email sync share it.
const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

// An empty phone widget still emits its dial code ("+1"). That is not a
// number, so it collapses to null instead of failing validation.
const BARE_DIAL_CODE_PATTERN = /^\+\d{1,3}$/;

// Roles listed on the unified Users & Roles roster. Deliberately excludes
// admin/employee: they hold no role profile, so they carry no licence, caseload
// or region. Kept separate from INVITE_USER_TYPES -- same members today, but one
// answers "who can be invited" and the other "who is listed".
// Archive (soft-delete) view for the roster, mirroring the patients list.
// active   -> only live people (default)
// all      -> live + archived people
// archived -> only archived people
const ROSTER_ARCHIVE_FILTERS = {
  ACTIVE: {value: 'active'},
  ALL: {value: 'all'},
  ARCHIVED: {value: 'archived'},
};

const ROSTER_ARCHIVE_FILTERS_VALUES = Object.values(ROSTER_ARCHIVE_FILTERS).map(
  (filter) => filter.value
);

const ROSTER_ROLES = [
  SYSTEM_ROLES.nurse.value,
  SYSTEM_ROLES.caregiver.value,
  SYSTEM_ROLES.case_manager.value,
];

/**
 * Canonical status vocabulary for the roster.
 *
 * The three per-role profile enums plus LOCKED_OUT, which lives on `users` and
 * outranks the profile status -- a locked-out nurse whose profile still reads
 * ACTIVE must not render as Active.
 *
 * Employment only. Where a person stands on getting a login is the separate
 * INVITATION_STATUSES below.
 */
const ROSTER_STATUSES = {
  ACTIVE: {value: 'ACTIVE'},
  INACTIVE: {value: 'INACTIVE'},
  HOLD: {value: 'HOLD'},
  ON_LEAVE: {value: 'ON_LEAVE'},
  TERMINATED: {value: 'TERMINATED'},
  REJECTED: {value: 'REJECTED'},
  LOCKED_OUT: {value: 'LOCKED_OUT'},
};

const ROSTER_STATUSES_VALUES = Object.values(ROSTER_STATUSES).map(
  (status) => status.value
);

/**
 * Which roles can actually hold each status.
 *
 * The three profile enums are not interchangeable -- HOLD, ON_LEAVE,
 * TERMINATED and REJECTED exist only on CaregiverStatus. Filtering a status
 * against a relation whose enum lacks it is a Prisma validation error, not an
 * empty result, so the query must only reach for the relations that accept it.
 */
const ROSTER_STATUS_ROLES = {
  [SYSTEM_ROLES.nurse.value]: ENTITY_STATUSES_VALUES,
  [SYSTEM_ROLES.case_manager.value]: ENTITY_STATUSES_VALUES,
  [SYSTEM_ROLES.caregiver.value]: CAREGIVER_STATUSES_VALUES,
};

/**
 * Where a person stands on getting a login. Derived, never stored: `isVerified`
 * alone cannot say it, because every HHAeXchange import is unverified without
 * ever having been invited.
 */
const INVITATION_STATUSES = {
  PENDING_REVIEW: {value: 'PENDING_REVIEW'},
  READY_TO_INVITE: {value: 'READY_TO_INVITE'},
  INVITED: {value: 'INVITED'},
  EXPIRED: {value: 'EXPIRED'},
  ACCEPTED: {value: 'ACCEPTED'},
  DEACTIVATED: {value: 'DEACTIVATED'},
  CONFLICT: {value: 'CONFLICT'},
};

const INVITATION_STATUSES_VALUES = Object.values(INVITATION_STATUSES).map(
  (status) => status.value
);

/** Why a person cannot be sent an invitation right now. */
const INVITE_BLOCK_REASONS = {
  NOT_FOUND: {value: 'NOT_FOUND', label: 'This person was not found'},
  ALREADY_ACCEPTED: {
    value: 'ALREADY_ACCEPTED',
    label: 'This person already accepted an invitation',
  },
  DEACTIVATED: {
    value: 'DEACTIVATED',
    label: 'This person is not active',
  },
  PLACEHOLDER_EMAIL: {
    value: 'PLACEHOLDER_EMAIL',
    label: 'This person has no login email yet',
  },
  INVALID_EMAIL: {
    value: 'INVALID_EMAIL',
    label: "This person's email is not valid",
  },
  EMAIL_CONFLICT: {
    value: 'EMAIL_CONFLICT',
    label: "This person's email has an open sync exception",
  },
  INVITATION_STILL_ACTIVE: {
    value: 'INVITATION_STILL_ACTIVE',
    label: 'An invitation was already sent and is still active',
  },
  SEND_FAILED: {
    value: 'SEND_FAILED',
    label: 'The invitation could not be sent',
  },
};

// People invited by one bulk request; each one sends an email.
const BULK_INVITATION_MAX_USERS = 100;

// Invitations sent at once; kept under the connection pool size.
const BULK_INVITATION_CONCURRENCY = 5;

// Where a roster profile came from. The nurse, caregiver and case manager
// source enums share these members, so one list filters all three.
const ROSTER_SOURCES = {
  MANUAL: {value: 'MANUAL'},
  HHA_EXCHANGE: {value: 'HHA_EXCHANGE'},
};

const ROSTER_SOURCES_VALUES = Object.values(ROSTER_SOURCES).map(
  (source) => source.value
);

// Sort fields for the roster. Only columns on `users` / `user_organizations`,
// so ordering stays index-friendly. LICENCE / CASELOAD is deliberately absent:
// it is polymorphic (a licence string for nurses, a count for the other two),
// so there is no single column to sort on.
const USERS_SORT_FIELDS = {
  firstName: {value: 'user.firstName', searchValue: 'user.firstName'},
  lastName: {value: 'user.lastName', searchValue: 'user.lastName'},
  email: {value: 'user.email', searchValue: 'user.email'},
  phoneNo: {value: 'user.phoneNo', searchValue: 'user.phoneNo'},
  role: {value: 'role', searchValue: 'role'},
  createdAt: {value: 'createdAt', searchValue: 'createdAt'},
};

const USERS_SORT_FIELDS_VALUES = Object.values(USERS_SORT_FIELDS).map(
  (field) => field.value
);

// Fields the roster search matches on, in `buildNameSearchClause` dotted form.
const USERS_SEARCH_FIELDS = ['user.firstName', 'user.lastName', 'user.email'];

module.exports = {
  PHONE_NUMBER_MAX_LENGTH,
  PHONE_NUMBER_PATTERN,
  PHONE_NUMBER_STRIP_PATTERN,
  EMAIL_PATTERN,
  BARE_DIAL_CODE_PATTERN,
  SYSTEM_ROLES,
  SYSTEM_ROLES_VALUES,
  INVITE_USER_TYPES,
  ROSTER_ROLES,
  ROSTER_ARCHIVE_FILTERS,
  ROSTER_ARCHIVE_FILTERS_VALUES,
  ROSTER_STATUSES,
  ROSTER_STATUSES_VALUES,
  ROSTER_STATUS_ROLES,
  INVITATION_STATUSES,
  INVITATION_STATUSES_VALUES,
  INVITE_BLOCK_REASONS,
  BULK_INVITATION_MAX_USERS,
  BULK_INVITATION_CONCURRENCY,
  ROSTER_SOURCES,
  ROSTER_SOURCES_VALUES,
  USERS_SORT_FIELDS,
  USERS_SORT_FIELDS_VALUES,
  USERS_SEARCH_FIELDS,
  LANGUAGES,
  LANGUAGES_VALUES,
  DEFAULT_LANGUAGE,
  UPDATABLE_USER_FIELDS,
  NON_UPDATABLE_USER_FIELDS,
  MAX_TIMESERIES_RANGE_DAYS,
  ADMIN_STATS_TRENDS_METRICS,
  FLAGS_RAISED_SERIES_KEYS,
  FLAGS_RAISED_BY_DAY_SQL,
  SLA_AT_RISK_COUNT_SQL,
  NURSE_RESPONSE_TIME_BY_ASSIGNEE_SQL,
};
