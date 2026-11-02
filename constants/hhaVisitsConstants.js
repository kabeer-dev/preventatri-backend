/**
 * HHAeXchange visit constants -- the PreventaTri side of the visit import.
 *
 * The wire-format names (element names, formats, value maps) live in
 * hhaExchangeConstants; this module holds what the stored row and the read
 * endpoint need: the status vocabulary, the sortable columns and the filters.
 */

/**
 * HhaVisit.status. Mirrors the HhaVisitStatus Postgres enum exactly.
 *
 * Derived by the visit mapper from the feed, in this order:
 *   IsMissedVisit truthy                     -> MISSED
 *   an actual or EVV END time is present     -> COMPLETED
 *   only an actual or EVV START is present   -> IN_PROGRESS
 *   otherwise                                -> SCHEDULED
 * DELETED is set only by the deleted-visit pass and is never overwritten by a
 * later change-feed row -- see hhaVisitSyncServices.
 * UNCONFIRMED is not stored -- see HHA_VISIT_DERIVED_STATUSES.
 */
const HHA_VISIT_STATUSES = {
  SCHEDULED: {value: 'SCHEDULED', label: 'Scheduled'},
  IN_PROGRESS: {value: 'IN_PROGRESS', label: 'In progress'},
  COMPLETED: {value: 'COMPLETED', label: 'Completed'},
  MISSED: {value: 'MISSED', label: 'Missed'},
  DELETED: {value: 'DELETED', label: 'Deleted'},
};

const HHA_VISIT_STATUSES_VALUES = Object.values(HHA_VISIT_STATUSES).map(
  (status) => status.value
);

/**
 * Worked out on read, never stored: the sync only rewrites a visit when HHA
 * changes it, and a slot simply ending changes nothing in HHA.
 * UNCONFIRMED = HHA's "Incomplete Confirmation" (slot ended, no clock-out).
 */
const HHA_VISIT_DERIVED_STATUSES = {
  UNCONFIRMED: {value: 'UNCONFIRMED', label: 'Unconfirmed'},
};

/** Stored statuses that read as UNCONFIRMED once the scheduled slot ends. */
const HHA_VISIT_UNCONFIRMABLE_STATUSES = [
  HHA_VISIT_STATUSES.SCHEDULED.value,
  HHA_VISIT_STATUSES.IN_PROGRESS.value,
];

/** Every status a caller can filter by or receive. */
const HHA_VISIT_FILTER_STATUSES_VALUES = HHA_VISIT_STATUSES_VALUES.concat(
  Object.values(HHA_VISIT_DERIVED_STATUSES).map((status) => status.value)
);

/** Status filter value meaning "every status, deleted included". */
const HHA_VISIT_STATUS_FILTER_ALL = 'all';

/**
 * HhaVisit.visitType. Mirrors the HhaVisitType Postgres enum exactly.
 *
 * These are the four options HHAeXchange's own CreateSchedule form offers for
 * VisitType, and they say how a visit was scheduled rather than what happened
 * on it: a fixed daily slot, a daily slot whose hours vary, a weekly pattern,
 * or a visit with no schedule behind it at all.
 *
 * The change feed types VisitType as a plain string and documents no domain
 * for it, so a value outside these four is NOT forced into one: the mapper
 * stores null and records an UNMAPPED_VISIT_TYPE exception naming it. Being
 * wrong about this list therefore costs one blank cell, not a failed import.
 */
const HHA_VISIT_TYPES = {
  DAILY_FIXED: {value: 'DAILY_FIXED', label: 'Daily Fixed'},
  DAILY_VARIABLE: {value: 'DAILY_VARIABLE', label: 'Daily Variable'},
  WEEKLY_VARIABLE: {value: 'WEEKLY_VARIABLE', label: 'Weekly Variable'},
  NO_SCHEDULE: {value: 'NO_SCHEDULE', label: 'No Schedule'},
};

const HHA_VISIT_TYPES_VALUES = Object.values(HHA_VISIT_TYPES).map(
  (visitType) => visitType.value
);

/** Visit type filter value meaning "every type, including unmapped ones". */
const HHA_VISIT_TYPE_FILTER_ALL = 'all';

const HHA_VISIT_SORT_FIELDS = {
  visitDate: {value: 'visitDate', searchValue: 'visitDate'},
  scheduledStartAt: {
    value: 'scheduledStartAt',
    searchValue: 'scheduledStartAt',
  },
  status: {value: 'status', searchValue: 'status'},
  patientLastName: {value: 'patientLastName', searchValue: 'patientLastName'},
  caregiverLastName: {
    value: 'caregiverLastName',
    searchValue: 'caregiverLastName',
  },
  hhaModifiedDate: {value: 'hhaModifiedDate', searchValue: 'hhaModifiedDate'},
};

const HHA_VISIT_SORT_FIELDS_VALUES = Object.values(HHA_VISIT_SORT_FIELDS).map(
  (field) => field.value
);

/** Default order when the caller sends no sortBy: newest visit day first. */
const HHA_VISIT_DEFAULT_SORT = {visitDate: 'desc'};

/** Columns a free-text search matches against, case-insensitively. */
const HHA_VISIT_SEARCH_NAME_FIELDS = [
  'patientFirstName',
  'patientLastName',
  'caregiverFirstName',
  'caregiverLastName',
];

const HHA_VISIT_SEARCH_MAX_LENGTH = 100;

module.exports = {
  HHA_VISIT_STATUSES,
  HHA_VISIT_STATUSES_VALUES,
  HHA_VISIT_DERIVED_STATUSES,
  HHA_VISIT_UNCONFIRMABLE_STATUSES,
  HHA_VISIT_FILTER_STATUSES_VALUES,
  HHA_VISIT_STATUS_FILTER_ALL,
  HHA_VISIT_TYPES,
  HHA_VISIT_TYPES_VALUES,
  HHA_VISIT_TYPE_FILTER_ALL,
  HHA_VISIT_SORT_FIELDS,
  HHA_VISIT_SORT_FIELDS_VALUES,
  HHA_VISIT_DEFAULT_SORT,
  HHA_VISIT_SEARCH_NAME_FIELDS,
  HHA_VISIT_SEARCH_MAX_LENGTH,
};
