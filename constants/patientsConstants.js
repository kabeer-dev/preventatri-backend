const GENDERS = {
  MALE: {value: 'MALE', label: 'Male'},
  FEMALE: {value: 'FEMALE', label: 'Female'},
  OTHER: {value: 'OTHER', label: 'Other'},
};

const GENDERS_VALUES = Object.values(GENDERS).map((gender) => gender.value);

const PATIENT_STATUSES = {
  ACTIVE: {value: 'ACTIVE', label: 'Active'},
  WAITING: {value: 'WAITING', label: 'Waiting'},
  HOSPITALIZED: {value: 'HOSPITALIZED', label: 'Hospitalized'},
  HOLD: {value: 'HOLD', label: 'Hold'},
  DISCHARGED: {value: 'DISCHARGED', label: 'Discharged'},
  ARCHIVED: {value: 'ARCHIVED', label: 'Archived'},
};

const PATIENT_STATUSES_VALUES = Object.values(PATIENT_STATUSES).map(
  (status) => status.value
);

const NON_ASSIGNABLE_PATIENT_STATUSES = [
  PATIENT_STATUSES.DISCHARGED.value,
  PATIENT_STATUSES.ARCHIVED.value,
];

const _patientStatusLabelMap = Object.values(PATIENT_STATUSES).reduce(
  (acc, s) => {
    acc[s.value] = s.label.toLowerCase();

    return acc;
  },
  {}
);

const _nonAssignableLabels = NON_ASSIGNABLE_PATIENT_STATUSES.map(
  (v) => _patientStatusLabelMap[v]
);

const NON_ASSIGNABLE_PATIENT_STATUSES_LABEL_STRING =
  _nonAssignableLabels.slice(0, _nonAssignableLabels.length - 1).join(', ') +
  ', or ' +
  _nonAssignableLabels[_nonAssignableLabels.length - 1];

/**
 * Where a patient record came from. Mirrors the PatientSource Postgres enum.
 * Every pre-existing patient is MANUAL — that is the column default, and it is
 * also the backfill performed by the add_hha_exchange_patient_sync migration.
 */
const PATIENT_SOURCES = {
  MANUAL: {value: 'MANUAL', label: 'Manual'},
  HHA_EXCHANGE: {value: 'HHA_EXCHANGE', label: 'HHAeXchange'},
};

const PATIENT_SOURCES_VALUES = Object.values(PATIENT_SOURCES).map(
  (source) => source.value
);

const RISK_LEVELS = {
  LOW: {value: 'LOW', label: 'Low'},
  MEDIUM: {value: 'MEDIUM', label: 'Medium'},
  HIGH: {value: 'HIGH', label: 'High'},
  CRITICAL: {value: 'CRITICAL', label: 'Critical'},
};

const RISK_LEVELS_VALUES = Object.values(RISK_LEVELS).map(
  (level) => level.value
);

// Archive (soft-delete) view filter for the patients list.
// active   -> only non-deleted patients (default)
// all      -> active + soft-deleted patients
// archived -> only soft-deleted patients
const PATIENT_ARCHIVE_FILTERS = {
  ACTIVE: {value: 'active'},
  ALL: {value: 'all'},
  ARCHIVED: {value: 'archived'},
};

const PATIENT_ARCHIVE_FILTERS_VALUES = Object.values(
  PATIENT_ARCHIVE_FILTERS
).map((filter) => filter.value);

const PATIENTS_SORT_FIELDS = {
  firstName: {value: 'firstName', searchValue: 'firstName'},
  lastName: {value: 'lastName', searchValue: 'lastName'},
  status: {value: 'status', searchValue: 'status'},
  createdAt: {value: 'createdAt', searchValue: 'createdAt'},
  dateOfBirth: {value: 'dateOfBirth', searchValue: 'dateOfBirth'},
};

const PATIENTS_SORT_FIELDS_VALUES = Object.values(PATIENTS_SORT_FIELDS).map(
  (field) => field.value
);

// Response views for GET /patients (?view=<value>). `fields` are the response
// keys returned for that view. Plain patient columns work as-is; derived or
// relation keys (county, region, primaryNurse, secondaryNurse, lastFlag,
// deletedAt) are resolved in PATIENTS_LIST_VIEW_FIELD_RESOLVERS
// (utils/patientUtils.js).
const PATIENTS_LIST_API_FIELDS_OPTIONS = {
  minimal: {
    value: 'minimal',
    fields: ['id', 'firstName', 'lastName'],
  },
  summary: {
    value: 'summary',
    fields: [
      'id',
      'firstName',
      'lastName',
      'dateOfBirth',
      'gender',
      'phoneNo',
      'diagnoses',
      'county',
    ],
  },
  table: {
    value: 'table',
    fields: [
      'id',
      'firstName',
      'lastName',
      'dateOfBirth',
      'gender',
      'diagnoses',
      'county',
      'region',
      'primaryNurse',
      'secondaryNurse',
      'caseManager',
      'assignedCaregivers',
      'status',
      'source',
      'lastFlag',
      'deletedAt',
    ],
  },
};

const PATIENTS_LIST_API_VIEWS_VALUES = Object.values(
  PATIENTS_LIST_API_FIELDS_OPTIONS
).map((option) => option.value);

module.exports = {
  GENDERS,
  GENDERS_VALUES,
  PATIENT_SOURCES,
  PATIENT_SOURCES_VALUES,
  PATIENT_STATUSES,
  PATIENT_STATUSES_VALUES,
  NON_ASSIGNABLE_PATIENT_STATUSES,
  NON_ASSIGNABLE_PATIENT_STATUSES_LABEL_STRING,
  RISK_LEVELS,
  RISK_LEVELS_VALUES,
  PATIENT_ARCHIVE_FILTERS,
  PATIENT_ARCHIVE_FILTERS_VALUES,
  PATIENTS_SORT_FIELDS,
  PATIENTS_SORT_FIELDS_VALUES,
  PATIENTS_LIST_API_FIELDS_OPTIONS,
  PATIENTS_LIST_API_VIEWS_VALUES,
};
