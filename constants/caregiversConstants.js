/**
 * Caregiver lifecycle statuses.
 *
 * Six values, mirroring the CaregiverStatus Postgres enum and the six statuses
 * HHAeXchange exposes, so an imported caregiver keeps the status the agency set
 * instead of being flattened into active/inactive.
 *
 * Deliberately NOT ENTITY_STATUSES from generalConstant: that two-value set is
 * shared with nurses, case managers and the common entityStatusSchema, and
 * widening it would offer HOLD / ON_LEAVE / TERMINATED / REJECTED on entities
 * whose Postgres enums have no such members.
 */
const CAREGIVER_STATUSES = {
  ACTIVE: {value: 'ACTIVE', label: 'Active', statsKey: 'activeCaregivers'},
  INACTIVE: {
    value: 'INACTIVE',
    label: 'Inactive',
    statsKey: 'inactiveCaregivers',
  },
  HOLD: {value: 'HOLD', label: 'Hold', statsKey: 'holdCaregivers'},
  ON_LEAVE: {
    value: 'ON_LEAVE',
    label: 'On Leave',
    statsKey: 'onLeaveCaregivers',
  },
  TERMINATED: {
    value: 'TERMINATED',
    label: 'Terminated',
    statsKey: 'terminatedCaregivers',
  },
  REJECTED: {
    value: 'REJECTED',
    label: 'Rejected',
    statsKey: 'rejectedCaregivers',
  },
};

const CAREGIVER_STATUSES_VALUES = Object.values(CAREGIVER_STATUSES).map(
  (status) => status.value
);

/**
 * Statuses that block authentication.
 *
 * HOLD and ON_LEAVE are deliberately absent: they are temporary states for a
 * caregiver who is still employed, and locking them out of the app would be a
 * new behaviour rather than a faithful import. INACTIVE keeps the meaning it
 * already had; TERMINATED and REJECTED are people who must not get in.
 */
const CAREGIVER_BLOCKED_STATUSES = [
  CAREGIVER_STATUSES.INACTIVE.value,
  CAREGIVER_STATUSES.TERMINATED.value,
  CAREGIVER_STATUSES.REJECTED.value,
];

/**
 * Where a caregiver record came from. Mirrors PATIENT_SOURCES and the
 * CaregiverSource Postgres enum: every caregiver invited by hand is MANUAL,
 * every caregiver the HHAeXchange sync creates or adopts is HHA_EXCHANGE.
 *
 * caregiver_profiles_hha_identity_check ties this to hha_caregiver_id -- a
 * MANUAL row never carries one, an HHA_EXCHANGE row always does.
 */
const CAREGIVER_SOURCES = {
  MANUAL: {value: 'MANUAL', label: 'Manual'},
  HHA_EXCHANGE: {value: 'HHA_EXCHANGE', label: 'HHAeXchange'},
};

const CAREGIVER_SOURCES_VALUES = Object.values(CAREGIVER_SOURCES).map(
  (source) => source.value
);

// Sort fields for caregiver list endpoint
// Maps display field names to actual database field names
// User fields (firstName, lastName, email, phoneNo) are accessed via user relation
const CAREGIVERS_SORT_FIELDS = {
  firstName: {value: 'user.firstName', searchValue: 'user.firstName'},
  lastName: {value: 'user.lastName', searchValue: 'user.lastName'},
  email: {value: 'user.email', searchValue: 'user.email'},
  phoneNo: {value: 'user.phoneNo', searchValue: 'user.phoneNo'},
  status: {value: 'status', searchValue: 'status'},
  createdAt: {value: 'createdAt', searchValue: 'createdAt'},
};

const CAREGIVERS_SORT_FIELDS_VALUES = Object.values(CAREGIVERS_SORT_FIELDS).map(
  (field) => field.value
);

module.exports = {
  CAREGIVER_SOURCES,
  CAREGIVER_SOURCES_VALUES,
  CAREGIVER_STATUSES,
  CAREGIVER_STATUSES_VALUES,
  CAREGIVER_BLOCKED_STATUSES,
  CAREGIVERS_SORT_FIELDS,
  CAREGIVERS_SORT_FIELDS_VALUES,
};
