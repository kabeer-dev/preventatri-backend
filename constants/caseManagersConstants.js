const {Prisma} = require('../generated/prisma/client');

/**
 * Where a case manager record came from. Mirrors CAREGIVER_SOURCES and the
 * CaseManagerSource Postgres enum: every case manager invited by hand is
 * MANUAL, every case manager the HHAeXchange sync creates or adopts is
 * HHA_EXCHANGE.
 *
 * HHAeXchange calls the role a Coordinator. The label here stays "HHAeXchange"
 * rather than naming the coordinator, because product copy says "Case Manager"
 * everywhere and "Coordinator" never leaves the wire format.
 *
 * case_manager_profiles_hha_identity_check ties this to hha_coordinator_id -- a
 * MANUAL row never carries one, an HHA_EXCHANGE row always does.
 */
const CASE_MANAGER_SOURCES = {
  MANUAL: {value: 'MANUAL', label: 'Manual'},
  HHA_EXCHANGE: {value: 'HHA_EXCHANGE', label: 'HHAeXchange'},
};

const CASE_MANAGER_SOURCES_VALUES = Object.values(CASE_MANAGER_SOURCES).map(
  (source) => source.value
);

// Sort fields for case manager list endpoint
// Maps display field names to actual database field names
// Email is on the user relation; names and phone are per organization on the
// userOrganization relation. `value` stays the public sortBy.
const CASE_MANAGERS_SORT_FIELDS = {
  firstName: {
    value: 'user.firstName',
    searchValue: 'userOrganization.firstName',
  },
  lastName: {value: 'user.lastName', searchValue: 'userOrganization.lastName'},
  email: {value: 'user.email', searchValue: 'user.email'},
  phoneNo: {value: 'user.phoneNo', searchValue: 'userOrganization.phoneNo'},
  status: {value: 'status', searchValue: 'status'},
  createdAt: {value: 'createdAt', searchValue: 'createdAt'},
};

const CASE_MANAGERS_SORT_FIELDS_VALUES = Object.values(
  CASE_MANAGERS_SORT_FIELDS
).map((field) => field.value);

const CASE_MANAGER_DASHBOARD_RATE_WINDOW_DAYS = 30;

const CASE_MANAGER_DASHBOARD_CHECKLIST_LIMIT = 7;

const CASE_MANAGER_DASHBOARD_ITEM_TYPES = {
  FOLLOW_UP: {value: 'FOLLOW_UP'},
  SUPERVISORY_VISIT: {value: 'SUPERVISORY_VISIT'},
};

// "assigneeId" has no @map, so its column is camelCase; see the warning on
// NURSE_RESPONSE_TIME_BY_ASSIGNEE_SQL before "normalizing" it.
const CASE_MANAGER_ASSESSMENT_RATE_SQL = ({
  resolvedAction,
  escalatedAction,
  level,
  userOrgId,
  since,
}) =>
  Prisma.sql`
  SELECT
    COUNT(*) FILTER (WHERE ev."action"::text = ${resolvedAction})::int AS resolved,
    COUNT(*) FILTER (WHERE ev."action"::text = ${escalatedAction})::int AS skipped
  FROM submission_flag_escalation_events ev
  WHERE ev."assigneeId" = ${userOrgId}
    AND ev."level"::text = ${level}
    AND ev."ended_at" >= ${since}
`;

module.exports = {
  CASE_MANAGER_ASSESSMENT_RATE_SQL,
  CASE_MANAGER_DASHBOARD_CHECKLIST_LIMIT,
  CASE_MANAGER_DASHBOARD_ITEM_TYPES,
  CASE_MANAGER_DASHBOARD_RATE_WINDOW_DAYS,
  CASE_MANAGER_SOURCES,
  CASE_MANAGER_SOURCES_VALUES,
  CASE_MANAGERS_SORT_FIELDS,
  CASE_MANAGERS_SORT_FIELDS_VALUES,
};
