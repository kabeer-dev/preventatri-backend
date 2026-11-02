/**
 * Region-related constants
 * Centralized here to maintain consistency across the codebase
 */

// Sort fields for region list endpoint
// Maps display field names to actual database field names
const REGIONS_SORT_FIELDS = {
  code: {value: 'code', searchValue: 'code'},
  name: {value: 'name', searchValue: 'name'},
  isActive: {value: 'isActive', searchValue: 'isActive'},
  createdAt: {value: 'createdAt', searchValue: 'createdAt'},
};

const REGIONS_SORT_FIELDS_VALUES = Object.values(REGIONS_SORT_FIELDS).map(
  (field) => field.value
);

// Archive (soft-delete) view for the regions list.
// active   -> only live regions (default, what every picker wants)
// all      -> live + archived regions
// archived -> only archived regions
const REGION_ARCHIVE_FILTERS = {
  ACTIVE: {value: 'active'},
  ALL: {value: 'all'},
  ARCHIVED: {value: 'archived'},
};

const REGION_ARCHIVE_FILTERS_VALUES = Object.values(REGION_ARCHIVE_FILTERS).map(
  (filter) => filter.value
);

module.exports = {
  REGION_ARCHIVE_FILTERS,
  REGION_ARCHIVE_FILTERS_VALUES,
  REGIONS_SORT_FIELDS,
  REGIONS_SORT_FIELDS_VALUES,
};
