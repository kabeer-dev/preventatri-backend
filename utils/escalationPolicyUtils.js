const {toLuxonUTC} = require('./dateUtils');

const {
  ESCALATION_STEP_TYPES,
  ESCALATION_TTL_UNITS,
  ESCALATION_STEP_CHANNELS,
  DEFAULT_ESCALATION_POLICY_STEPS,
  SECONDARY_NURSE_ESCALATION_LEVELS,
} = require('../constants/escalationConstants');

const {NOTIFICATION_CHANNELS} = require('../constants/notificationConstants');

// Compute the row's expiresAt from the minutes of the step it is landing on.
// Returns a JS Date, or null when the step has no timer (ttlMinutes null — the
// terminal ADMIN step). A null expiresAt means the row never expires: it's
// naturally excluded from the `expiresAt <= now` cron query (null never
// matches), so it just stays at its terminal step until resolved/voided.
function computeEscalationExpiresAt({ttlMinutes, now}) {
  if (ttlMinutes === null || ttlMinutes === undefined) {
    return null;
  }

  return toLuxonUTC({date: now}).plus({minutes: ttlMinutes}).toJSDate();
}

// At least one known channel, none repeated.
function isValidStepChannels({channels}) {
  return (
    Array.isArray(channels) &&
    channels.length > 0 &&
    new Set(channels).size === channels.length &&
    channels.every((channel) => ESCALATION_STEP_CHANNELS.includes(channel))
  );
}

// A positive whole number of minutes that is a whole number of `ttlUnit`s, so
// the settings screen can show it back in the unit the admin chose.
function isValidStepTimer({ttlMinutes, ttlUnit}) {
  const unit = ESCALATION_TTL_UNITS[ttlUnit];

  return (
    Boolean(unit) &&
    Number.isInteger(ttlMinutes) &&
    ttlMinutes >= 1 &&
    ttlMinutes % unit.minutes === 0
  );
}

// A usable policy is a non-empty list of distinct known step types, each with a
// timer and at least one notify channel, ending with ADMIN — the only step with
// no timer, so a flag can never run past the end of the list or be left with
// nobody.
function isValidPolicySteps({steps}) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return false;
  }

  const seenTypes = new Set();

  return steps.every((step, index) => {
    const isLast = index === steps.length - 1;
    const isAdmin = step?.type === ESCALATION_STEP_TYPES.ADMIN.value;

    if (!ESCALATION_STEP_TYPES[step?.type] || seenTypes.has(step.type)) {
      return false;
    }

    seenTypes.add(step.type);

    if (!isValidStepChannels({channels: step.channels})) {
      return false;
    }

    if (isLast) {
      return isAdmin && step.ttlMinutes === null && step.ttlUnit === null;
    }

    return !isAdmin && isValidStepTimer(step);
  });
}

function getDefaultPolicySteps({flag}) {
  return DEFAULT_ESCALATION_POLICY_STEPS[flag] || null;
}

// Index of the step whose levels include `level` (e.g. REGION_PRIMARY_NURSE →
// the PRIMARY_NURSE step). Used for escalations that predate currentStepIndex.
function getStepIndexForLevel({steps, level}) {
  return steps.findIndex((step) =>
    ESCALATION_STEP_TYPES[step.type]?.levels.some((l) => l.value === level)
  );
}

// The steps and current position an existing escalation follows: its pinned
// policy version when present and valid, otherwise the built-in default for its
// flag color (rows started before policies existed). Returns null when neither
// is available (e.g. a color with no default flow).
function resolveEscalationPolicyState({escalation, flag}) {
  const pinnedSteps = escalation?.policy?.steps;

  const steps = isValidPolicySteps({steps: pinnedSteps})
    ? pinnedSteps
    : getDefaultPolicySteps({flag});

  if (!steps) {
    return null;
  }

  const currentStepIndex = Number.isInteger(escalation?.currentStepIndex)
    ? escalation.currentStepIndex
    : getStepIndexForLevel({steps, level: escalation?.currentLevel});

  return {steps, currentStepIndex};
}

// Flatten steps into the ordered list of concrete levels to try, starting at
// `fromStepIndex`. Each candidate remembers which step it belongs to so the
// caller can pick up that step's timer.
//
// A nurse step pages the patient's nurse; the region's nurse is only a
// stand-in for when the patient has none. So when a flag expires on the
// patient's own nurse, the rest of that step (the region's nurse) is skipped and
// the flow moves straight to the next step.
//
// With `afterLevel`, only the levels after that one (within step
// `fromStepIndex`, then the following steps) are returned — where an expiring
// escalation goes next. Null when `afterLevel` is not a level of that step.
function getPolicyLevelCandidates({steps, fromStepIndex, afterLevel = null}) {
  const candidates = steps.slice(fromStepIndex).flatMap((step, offset) =>
    (ESCALATION_STEP_TYPES[step.type]?.levels || []).map((level) => ({
      stepIndex: fromStepIndex + offset,
      level,
    }))
  );

  if (!afterLevel) {
    return candidates;
  }

  const position = candidates.findIndex(
    ({stepIndex, level}) =>
      stepIndex === fromStepIndex && level.value === afterLevel
  );

  if (position < 0) {
    return null;
  }

  // The patient's own nurse held it (the step's first level): the region's
  // nurse is never the next stop of that step.
  const isPatientLevel =
    ESCALATION_STEP_TYPES[steps[fromStepIndex].type]?.levels[0]?.value ===
    afterLevel;

  return candidates
    .slice(position + 1)
    .filter(({stepIndex}) => !(isPatientLevel && stepIndex === fromStepIndex));
}

// Steps as the settings screen shows them: each nurse step carries a read-only
// `fallback` — the region nurse who is paged automatically only when the
// patient has no nurse for that tier (same deadline and channels as the step). It is derived from ESCALATION_STEP_TYPES, never
// stored, and never accepted on save, so it can't be edited or removed on its
// own. Steps with no fallback get null.
function withStepFallbacks({steps}) {
  return steps.map(({type, ttlMinutes, ttlUnit, channels}) => {
    const fallbackLevel = ESCALATION_STEP_TYPES[type]?.levels[1] || null;

    return {
      type,
      ttlMinutes,
      ttlUnit,
      channels,
      fallback: fallbackLevel
        ? {level: fallbackLevel.value, ttlMinutes, ttlUnit, channels}
        : null,
    };
  });
}

// The most the case manager can be told on, before the admin's choice: in-app
// only while a primary-tier nurse holds the flag, in-app + SMS once a
// secondary-tier nurse does.
function getCaseManagerTierChannels({levelValue}) {
  return SECONDARY_NURSE_ESCALATION_LEVELS.includes(levelValue)
    ? [NOTIFICATION_CHANNELS.IN_APP, NOTIFICATION_CHANNELS.SMS]
    : [NOTIFICATION_CHANNELS.IN_APP];
}

// Channels the patient's case manager is kept informed on while a nurse holds
// the flag (they are an overseer, not the assignee). The nurse tier sets the
// most they get — in-app only while a primary-tier nurse holds it, in-app + SMS
// once a secondary-tier nurse does — and the policy's CASE_MANAGER step
// narrows that to what the admin chose for the case manager. A policy without
// a CASE_MANAGER step leaves the tier rule as is. May be empty: the admin
// turned off every channel the tier allows, so the case manager isn't told.
function getCaseManagerOverseerChannels({steps, levelValue}) {
  const tierChannels = getCaseManagerTierChannels({levelValue});

  const caseManagerStep = (steps || []).find(
    (step) => step.type === ESCALATION_STEP_TYPES.CASE_MANAGER.value
  );

  if (!caseManagerStep) {
    return tierChannels;
  }

  return tierChannels.filter((channel) =>
    caseManagerStep.channels.includes(channel)
  );
}

// The channels each person should be told on, from the steps they held:
// `events` are escalation events ({level, userId}); each maps to its policy
// step's channels. Someone who held several steps gets every channel of those
// steps. Events whose level has no step in `steps` contribute nothing.
// Returns {[userId]: channels[]}.
function getChannelsByAssignee({steps, events}) {
  const channelsByUserId = {};

  (events || []).forEach(({level, userId}) => {
    const stepIndex = getStepIndexForLevel({steps, level});

    if (!userId || stepIndex < 0) {
      return;
    }

    const merged = new Set(channelsByUserId[userId] || []);
    steps[stepIndex].channels.forEach((channel) => merged.add(channel));

    // Keep the canonical channel order for stable output.
    channelsByUserId[userId] = ESCALATION_STEP_CHANNELS.filter((channel) =>
      merged.has(channel)
    );
  });

  return channelsByUserId;
}

// A step in its fixed key order, so stored rows compare equal regardless of how
// they were written.
function normalizeStep({type, ttlMinutes, ttlUnit, channels}) {
  return {type, ttlMinutes, ttlUnit, channels};
}

// Whether two step lists describe the same flow (key order ignored).
function isSameSteps({a, b}) {
  return (
    Array.isArray(a) &&
    JSON.stringify(a.map(normalizeStep)) ===
      JSON.stringify(b.map(normalizeStep))
  );
}

// A policy row as the settings screen shows it: the steps new escalations will
// actually follow (a stored version that fails validation reports the built-in
// default), each with its read-only region fallback.
function formatPolicySettings({policy}) {
  const steps = isValidPolicySteps({steps: policy.steps})
    ? policy.steps
    : getDefaultPolicySteps({flag: policy.flag});

  return {
    flag: policy.flag,
    version: policy.version,
    steps: withStepFallbacks({steps}),
    updatedAt: policy.createdAt,
    updatedBy: policy.createdBy,
  };
}

module.exports = {
  normalizeStep,
  isSameSteps,
  formatPolicySettings,
  computeEscalationExpiresAt,
  getCaseManagerOverseerChannels,
  getCaseManagerTierChannels,
  getChannelsByAssignee,
  isValidPolicySteps,
  getDefaultPolicySteps,
  getStepIndexForLevel,
  resolveEscalationPolicyState,
  getPolicyLevelCandidates,
  withStepFallbacks,
};
