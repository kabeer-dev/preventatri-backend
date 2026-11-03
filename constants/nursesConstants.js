/**
 * Nurse-related enum constants
 * These are centralized here to maintain consistency across the codebase
 * and match Prisma schema definitions
 */

const {CHECKLIST_SUBMISSION_STATUSES} = require('./assessmentConstants');

const PROFESSIONAL_ROLES = {
  RN: {value: 'RN', label: 'Registered Nurse'},
  LPN: {value: 'LPN', label: 'Licensed Practical Nurse'},
};

const PROFESSIONAL_ROLES_VALUES = Object.values(PROFESSIONAL_ROLES).map(
  (role) => role.value
);

/**
 * Where a nurse record came from. Mirrors CAREGIVER_SOURCES and the
 * NurseSource Postgres enum: every nurse invited by hand is MANUAL, every nurse
 * the HHAeXchange sync creates, adopts or reclassifies is HHA_EXCHANGE.
 *
 * nurse_profiles_hha_identity_check ties this to hha_nurse_id -- a MANUAL row
 * never carries one, an HHA_EXCHANGE row always does.
 */
const NURSE_SOURCES = {
  MANUAL: {value: 'MANUAL', label: 'Manual'},
  HHA_EXCHANGE: {value: 'HHA_EXCHANGE', label: 'HHAeXchange'},
};

const NURSE_SOURCES_VALUES = Object.values(NURSE_SOURCES).map(
  (source) => source.value
);

/**
 * The licence state a nurse gets when none is supplied. PA-based agency, so
 * PA -- and it is the one value the invite controller, the profile service and
 * the Yup default all have to agree on.
 */
const NURSE_DEFAULT_LICENSE_STATE = 'PA';

// Sort fields for nurse list endpoint
// Maps display field names to actual database field names
// Email is on the user relation; names and phone are per organization on the
// userOrganization relation. `value` stays the public sortBy.
const NURSES_SORT_FIELDS = {
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

const NURSES_SORT_FIELDS_VALUES = Object.values(NURSES_SORT_FIELDS).map(
  (field) => field.value
);

const NURSE_REGION_ROLES = {
  PRIMARY: 'PRIMARY',
  SECONDARY: 'SECONDARY',
};

const NURSE_DASHBOARD_ITEM_TYPES = {
  FOLLOW_UP: {value: 'FOLLOW_UP', label: 'Follow-up'},
  SUPERVISORY_VISIT: {value: 'SUPERVISORY_VISIT', label: 'Supervisory visit'},
};

const NURSE_DASHBOARD_SUBMITTED_STATUSES = [
  CHECKLIST_SUBMISSION_STATUSES.SUBMITTED.value,
  CHECKLIST_SUBMISSION_STATUSES.REVIEWED.value,
];

// Wall-clock time shown on the "My day" rows (in the task's own zone).
const NURSE_DASHBOARD_DUE_TIME_FORMAT = 'HH:mm';

module.exports = {
  PROFESSIONAL_ROLES,
  PROFESSIONAL_ROLES_VALUES,
  NURSE_SOURCES,
  NURSE_SOURCES_VALUES,
  NURSE_DEFAULT_LICENSE_STATE,
  NURSES_SORT_FIELDS,
  NURSES_SORT_FIELDS_VALUES,
  NURSE_REGION_ROLES,
  NURSE_DASHBOARD_ITEM_TYPES,
  NURSE_DASHBOARD_SUBMITTED_STATUSES,
  NURSE_DASHBOARD_DUE_TIME_FORMAT,
};
