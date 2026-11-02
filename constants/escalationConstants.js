const {ALL_NOTIFICATION_CHANNELS} = require('./notificationConstants');

// The concrete assignee slots an escalation can land on (persisted as
// `currentLevel` / event `level`). TTLs and the order of the flow are NOT here —
// they live in the organization's EscalationPolicy (see ESCALATION_STEP_TYPES).
const ESCALATION_LEVELS = {
  PATIENT_PRIMARY_NURSE: {value: 'PATIENT_PRIMARY_NURSE', order: 1},
  REGION_PRIMARY_NURSE: {value: 'REGION_PRIMARY_NURSE', order: 2},
  PATIENT_SECONDARY_NURSE: {value: 'PATIENT_SECONDARY_NURSE', order: 3},
  REGION_SECONDARY_NURSE: {value: 'REGION_SECONDARY_NURSE', order: 4},
  CASE_MANAGER: {value: 'CASE_MANAGER', order: 5},
  ADMIN: {value: 'ADMIN', order: 6},
};

// The steps an EscalationPolicy is built from. Each step owns one deadline and
// pages its `levels` in order, each on that deadline: a nurse step goes to the
// patient's nurse and, if they don't respond in time (or the patient has
// none) — only then — to the region's nurse. If the patient's nurse holds the
// flag and doesn't respond, the flow moves on to the next step. The
// REGION_* levels come with their step automatically — they are never steps of
// their own, so the admin can't edit or remove them separately.
const ESCALATION_STEP_TYPES = {
  PRIMARY_NURSE: {
    value: 'PRIMARY_NURSE',
    levels: [
      ESCALATION_LEVELS.PATIENT_PRIMARY_NURSE,
      ESCALATION_LEVELS.REGION_PRIMARY_NURSE,
    ],
  },
  SECONDARY_NURSE: {
    value: 'SECONDARY_NURSE',
    levels: [
      ESCALATION_LEVELS.PATIENT_SECONDARY_NURSE,
      ESCALATION_LEVELS.REGION_SECONDARY_NURSE,
    ],
  },
  CASE_MANAGER: {
    value: 'CASE_MANAGER',
    levels: [ESCALATION_LEVELS.CASE_MANAGER],
  },
  ADMIN: {
    value: 'ADMIN',
    levels: [ESCALATION_LEVELS.ADMIN],
  },
};

const ESCALATION_STEP_TYPES_VALUES = Object.values(ESCALATION_STEP_TYPES).map(
  (s) => s.value
);

// Flag colors that escalate and therefore carry a policy. GREEN never escalates.
const ESCALATION_POLICY_FLAGS = ['RED', 'YELLOW'];

// Unit the admin entered a step's deadline in. The engine only reads
// `ttlMinutes`; the unit is kept so the settings screen shows "2 hours" back
// instead of "120 minutes".
const ESCALATION_TTL_UNITS = {
  MINUTES: {value: 'MINUTES', minutes: 1},
  HOURS: {value: 'HOURS', minutes: 60},
};

// Channels a step's assignee can be notified on ("Push" in the UI is IN_APP).
const ESCALATION_STEP_CHANNELS = ALL_NOTIFICATION_CHANNELS;

// Every non-terminal step waits `ttlMinutes`; the terminal ADMIN step has no
// timer. Each step notifies on every channel, as before policies existed.
const buildDefaultSteps = ({ttlMinutes}) =>
  Object.values(ESCALATION_STEP_TYPES).map((stepType) => {
    const isAdmin = stepType === ESCALATION_STEP_TYPES.ADMIN;

    return {
      type: stepType.value,
      ttlMinutes: isAdmin ? null : ttlMinutes,
      ttlUnit: isAdmin ? null : ESCALATION_TTL_UNITS.MINUTES.value,
      channels: ESCALATION_STEP_CHANNELS.slice(),
    };
  });

// Built-in flow, used as version 1 of every organization's policy and as the
// fallback for escalations started before policies existed. ADMIN is always the
// terminal step (ttlMinutes=null → never expires): the flag stays assigned to
// the admin and pending until resolved. Nothing escalates past ADMIN and no
// flag transitions to EXPIRED, so the SLA "terminal" population is RESOLVED only.
const DEFAULT_ESCALATION_POLICY_STEPS = {
  RED: buildDefaultSteps({ttlMinutes: 3}),
  YELLOW: buildDefaultSteps({ttlMinutes: 5}),
};

const ESCALATION_LEVELS_VALUES = Object.values(ESCALATION_LEVELS).map(
  (l) => l.value
);

// Levels at which the assignee is a nurse. Used to decide when the patient's
// case manager should be notified as an overseer (they are the assignee at
// CASE_MANAGER, and ADMIN has no CM overseer).
const NURSE_ESCALATION_LEVELS = [
  ESCALATION_LEVELS.PATIENT_PRIMARY_NURSE.value,
  ESCALATION_LEVELS.REGION_PRIMARY_NURSE.value,
  ESCALATION_LEVELS.PATIENT_SECONDARY_NURSE.value,
  ESCALATION_LEVELS.REGION_SECONDARY_NURSE.value,
];

// Nurse levels grouped by tier. Used to decide the case-manager overseer's
// notification channels: at the PRIMARY tier the CM is kept in-app only; at the
// SECONDARY tier the CM also gets an SMS. The region-fallback levels ride with
// their tier (region-primary → primary, region-secondary → secondary).
const PRIMARY_NURSE_ESCALATION_LEVELS = [
  ESCALATION_LEVELS.PATIENT_PRIMARY_NURSE.value,
  ESCALATION_LEVELS.REGION_PRIMARY_NURSE.value,
];

const SECONDARY_NURSE_ESCALATION_LEVELS = [
  ESCALATION_LEVELS.PATIENT_SECONDARY_NURSE.value,
  ESCALATION_LEVELS.REGION_SECONDARY_NURSE.value,
];

// ACKNOWLEDGED is shown as "Accepted": the assignee took the flag, so it stops
// escalating (no expiresAt) and stays with them until they resolve it.
const ESCALATION_STATUSES = {
  ACTIVE: {value: 'ACTIVE'},
  ACKNOWLEDGED: {value: 'ACKNOWLEDGED'},
  RESOLVED: {value: 'RESOLVED'},
  EXPIRED: {value: 'EXPIRED'},
  FAILED: {value: 'FAILED'},
  VOIDED: {value: 'VOIDED'},
};

const ESCALATION_STATUSES_VALUES = Object.values(ESCALATION_STATUSES).map(
  (s) => s.value
);

// Escalations still waiting on their assignee: not yet accepted, or accepted
// and not yet resolved.
const OPEN_ESCALATION_STATUSES = [
  ESCALATION_STATUSES.ACTIVE.value,
  ESCALATION_STATUSES.ACKNOWLEDGED.value,
];

// Levels whose assignee can accept a flag. ADMIN is the last step and never
// escalates, so there is nothing to stop there.
const ACCEPTABLE_ESCALATION_LEVELS = ESCALATION_LEVELS_VALUES.filter(
  (level) => level !== ESCALATION_LEVELS.ADMIN.value
);

const ESCALATION_ACTIONS = {
  ASSIGNED: {value: 'ASSIGNED'},
  RESOLVED: {value: 'RESOLVED'},
  ESCALATED: {value: 'ESCALATED'},
  EXPIRED: {value: 'EXPIRED'},
  VOIDED: {value: 'VOIDED'},
};

const ESCALATION_ACTIONS_VALUES = Object.values(ESCALATION_ACTIONS).map(
  (a) => a.value
);

const ALERT_STATS_WINDOW_DAYS = 30;

// Actions an assignee can record when resolving an escalation. Integer-coded
// (like RED_FLAG_REASONS) so the set can grow without a column migration; stored
// as an Int[] on the escalation-response row (multiple may be selected).
const ESCALATION_RESPONSE_ACTIONS = {
  0: {
    value: 0,
    label: 'Guided Caregiver on Call',
    code: 'guided_caregiver_on_call',
  },
  1: {
    value: 1,
    label: 'Guided Patient on Call',
    code: 'guided_patient_on_call',
  },
  2: {
    value: 2,
    label: 'Sent Instructions to Caregiver and Patient',
    code: 'sent_instructions',
  },
  3: {value: 3, label: 'Team Dispatched', code: 'team_dispatched'},
};

const ESCALATION_RESPONSE_ACTIONS_VALUES = Object.values(
  ESCALATION_RESPONSE_ACTIONS
).map((a) => a.value);

// Escalation stages where the assignee is a nurse — an event at one of these
// levels means a nurse was alerted (paged) for the flag.
const NURSE_ESCALATION_LEVELS_VALUES = [
  ESCALATION_LEVELS.PATIENT_PRIMARY_NURSE.value,
  ESCALATION_LEVELS.REGION_PRIMARY_NURSE.value,
  ESCALATION_LEVELS.PATIENT_SECONDARY_NURSE.value,
  ESCALATION_LEVELS.REGION_SECONDARY_NURSE.value,
];

module.exports = {
  ESCALATION_LEVELS,
  ESCALATION_LEVELS_VALUES,
  ESCALATION_STEP_TYPES,
  ESCALATION_STEP_TYPES_VALUES,
  ESCALATION_POLICY_FLAGS,
  ESCALATION_TTL_UNITS,
  ESCALATION_STEP_CHANNELS,
  DEFAULT_ESCALATION_POLICY_STEPS,
  NURSE_ESCALATION_LEVELS,
  PRIMARY_NURSE_ESCALATION_LEVELS,
  SECONDARY_NURSE_ESCALATION_LEVELS,
  NURSE_ESCALATION_LEVELS_VALUES,
  ESCALATION_STATUSES,
  ESCALATION_STATUSES_VALUES,
  OPEN_ESCALATION_STATUSES,
  ACCEPTABLE_ESCALATION_LEVELS,
  ESCALATION_ACTIONS,
  ESCALATION_ACTIONS_VALUES,
  ALERT_STATS_WINDOW_DAYS,
  ESCALATION_RESPONSE_ACTIONS,
  ESCALATION_RESPONSE_ACTIONS_VALUES,
};
