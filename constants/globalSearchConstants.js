const {ROSTER_ROLES} = require('./usersConstants');

const GLOBAL_SEARCH_LIMITS = {
  minChars: 2,
  defaultLimit: 5,
  maxLimit: 10,
};

// Staff rows are typed by their role value instead, so the client maps both with one lookup.
const GLOBAL_SEARCH_RESULT_TYPES = {
  patient: 'patient',
};

const GLOBAL_SEARCH_STAFF_ROLES = ROSTER_ROLES;

// A specific-field list skips Patient's default fields, which carry health details. `county` returns its own columns only.
const GLOBAL_SEARCH_PATIENT_FIELDS = ['id', 'firstName', 'lastName', 'county'];

const GLOBAL_SEARCH_REGION_FIELDS = ['id', 'name'];

const GLOBAL_SEARCH_STAFF_USER_SELECT = {
  firstName: true,
  lastName: true,
  email: true,
};

const GLOBAL_SEARCH_PROFILE_SELECT = {id: true};

const GLOBAL_SEARCH_PATIENT_SORT = [{firstName: 'asc'}, {lastName: 'asc'}];

const GLOBAL_SEARCH_STAFF_SORT = [
  {user: {firstName: 'asc'}},
  {user: {lastName: 'asc'}},
];

module.exports = {
  GLOBAL_SEARCH_LIMITS,
  GLOBAL_SEARCH_RESULT_TYPES,
  GLOBAL_SEARCH_STAFF_ROLES,
  GLOBAL_SEARCH_PATIENT_FIELDS,
  GLOBAL_SEARCH_REGION_FIELDS,
  GLOBAL_SEARCH_STAFF_USER_SELECT,
  GLOBAL_SEARCH_PROFILE_SELECT,
  GLOBAL_SEARCH_PATIENT_SORT,
  GLOBAL_SEARCH_STAFF_SORT,
};
