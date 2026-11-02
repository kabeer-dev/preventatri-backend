const CHECKLIST_ASSIGNMENT_TYPES = {
  DAILY: {value: 'DAILY', label: 'Daily'},
  WEEKLY: {value: 'WEEKLY', label: 'Weekly'},
  MONTHLY: {value: 'MONTHLY', label: 'Monthly'},
};

const CHECKLIST_ASSIGNMENT_TYPES_VALUES = Object.values(
  CHECKLIST_ASSIGNMENT_TYPES
).map((type) => type.value);

const CHECKLIST_ASSIGNMENTS_SORT_FIELDS = {
  startDate: {value: 'startDate', searchValue: 'startDate'},
  endDate: {value: 'endDate', searchValue: 'endDate'},
  createdAt: {value: 'createdAt', searchValue: 'createdAt'},
};

const CHECKLIST_ASSIGNMENTS_SORT_FIELDS_VALUES = Object.values(
  CHECKLIST_ASSIGNMENTS_SORT_FIELDS
).map((field) => field.value);

// Number of grace days after deadline that dueDate is set, per assignment type
const DUE_DATE_OFFSET_DAYS = {
  DAILY: 2,
  WEEKLY: 3,
  MONTHLY: 7,
};

const UPCOMING_LOOKAHEAD_DAYS = 3;

module.exports = {
  CHECKLIST_ASSIGNMENT_TYPES,
  CHECKLIST_ASSIGNMENT_TYPES_VALUES,
  CHECKLIST_ASSIGNMENTS_SORT_FIELDS,
  CHECKLIST_ASSIGNMENTS_SORT_FIELDS_VALUES,
  DUE_DATE_OFFSET_DAYS,
  UPCOMING_LOOKAHEAD_DAYS,
};
