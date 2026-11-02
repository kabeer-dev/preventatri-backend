// Default weekly working hours applied to every organization on creation.
// Mirrors the DB-level default on organizations.working_hours (see the
// add_organization_working_hours migration) so callers building organization
// payloads have an explicit, reusable source for the same default.
const DEFAULT_WORKING_HOURS = {
  monday: {enabled: true, startTime: '09:00', endTime: '17:00'},
  tuesday: {enabled: true, startTime: '09:00', endTime: '17:00'},
  wednesday: {enabled: true, startTime: '09:00', endTime: '17:00'},
  thursday: {enabled: true, startTime: '09:00', endTime: '17:00'},
  friday: {enabled: true, startTime: '09:00', endTime: '17:00'},
  saturday: {enabled: true, startTime: '09:00', endTime: '17:00'},
  sunday: {enabled: false, startTime: '09:00', endTime: '17:00'},
};

// Luxon weekday numbers (1=Monday..7=Sunday) mapped to the lowercase day keys
// used on Organization.workingHours above.
const WEEKDAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

// Supported USA time zones. `key` is the Prisma OrganizationTimeZone enum
// member stored on organizations.time_zone (see the
// add_organization_time_zone migration); `value` is the IANA identifier
// Luxon/Intl expect for actual time-zone-aware date math; `label` is the
// display string for clients.
const AVAILABLE_TIME_ZONES = {
  eastern: {
    value: 'America/New_York',
    label: 'Eastern Time (US & Canada)',
    key: 'EASTERN',
  },
  central: {
    value: 'America/Chicago',
    label: 'Central Time (US & Canada)',
    key: 'CENTRAL',
  },
  mountain: {
    value: 'America/Denver',
    label: 'Mountain Time (US & Canada)',
    key: 'MOUNTAIN',
  },
  pacific: {
    value: 'America/Los_Angeles',
    label: 'Pacific Time (US & Canada)',
    key: 'PACIFIC',
  },
  alaska: {
    value: 'America/Anchorage',
    label: 'Alaska Time (US & Canada)',
    key: 'ALASKA',
  },
  hawaii: {
    value: 'Pacific/Honolulu',
    label: 'Hawaii Time (US & Canada)',
    key: 'HAWAII',
  },
};

// Default time zone applied to every organization on creation. Mirrors the
// DB-level default on organizations.time_zone (see the
// add_organization_time_zone migration) so callers building organization
// payloads have an explicit, reusable source for the same default.
const DEFAULT_TIME_ZONE_KEY = AVAILABLE_TIME_ZONES.eastern.key;

// The 6 Prisma OrganizationTimeZone enum members, for validating a
// requested timeZone before it's persisted.
const TIME_ZONE_KEYS = Object.values(AVAILABLE_TIME_ZONES).map(
  (timeZone) => timeZone.key
);

// Mirrors the OrganizationStatus Postgres enum. Only an active organization can
// be logged into; pending is a new signup waiting for approval.
const ORGANIZATION_STATUSES = {
  PENDING: {value: 'pending', label: 'Pending approval'},
  ACTIVE: {value: 'active', label: 'Active'},
  REJECTED: {value: 'rejected', label: 'Rejected'},
  SUSPENDED: {value: 'suspended', label: 'Suspended'},
};

const ORGANIZATION_STATUSES_VALUES = Object.values(ORGANIZATION_STATUSES).map(
  (status) => status.value
);

// What the super admin can do to an organization: the status it must be in, the
// status it moves to, and whether a reason is kept. A rejected organization
// stays rejected.
const ORGANIZATION_ACTIONS = {
  approve: {
    from: ORGANIZATION_STATUSES.PENDING.value,
    to: ORGANIZATION_STATUSES.ACTIVE.value,
  },
  reject: {
    from: ORGANIZATION_STATUSES.PENDING.value,
    to: ORGANIZATION_STATUSES.REJECTED.value,
  },
  suspend: {
    from: ORGANIZATION_STATUSES.ACTIVE.value,
    to: ORGANIZATION_STATUSES.SUSPENDED.value,
  },
  reactivate: {
    from: ORGANIZATION_STATUSES.SUSPENDED.value,
    to: ORGANIZATION_STATUSES.ACTIVE.value,
  },
};

const ORGANIZATION_ACTIONS_WITH_REASON = ['reject', 'suspend'];

const ORGANIZATION_REASON_MAX_LENGTH = 1000;

module.exports = {
  ORGANIZATION_STATUSES,
  ORGANIZATION_STATUSES_VALUES,
  ORGANIZATION_ACTIONS,
  ORGANIZATION_ACTIONS_WITH_REASON,
  ORGANIZATION_REASON_MAX_LENGTH,
  DEFAULT_WORKING_HOURS,
  WEEKDAY_KEYS,
  DEFAULT_TIME_ZONE_KEY,
  AVAILABLE_TIME_ZONES,
  TIME_ZONE_KEYS,
};
