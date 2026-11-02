/**
 * County-related constants
 * Centralized here to maintain consistency across the codebase
 */

// Sort fields for county list endpoint
// Maps display field names to actual database field names
const COUNTIES_SORT_FIELDS = {
  name: {value: 'name', searchValue: 'name'},
  createdAt: {value: 'createdAt', searchValue: 'createdAt'},
};

const COUNTIES_SORT_FIELDS_VALUES = Object.values(COUNTIES_SORT_FIELDS).map(
  (field) => field.value
);

const COUNTY_LABEL_SEPARATOR = ', ';

const US_STATE_CODE_LENGTH = 2;

module.exports = {
  COUNTIES_SORT_FIELDS,
  COUNTIES_SORT_FIELDS_VALUES,
  COUNTY_LABEL_SEPARATOR,
  US_STATE_CODE_LENGTH,
};
