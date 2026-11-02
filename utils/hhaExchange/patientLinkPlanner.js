/**
 * Decide what the patient sync writes for one HHA patient's county and links.
 *
 * Pure: every lookup arrives resolved. HHAeXchange owns the case manager on HHA
 * patients, the county while the ZIP resolves, and the primary nurse while it
 * names one; otherwise an admin picks the nurse and the sync keeps that pick,
 * reporting a conflict if HHAeXchange later names someone else. An id or name
 * that resolves to nobody never clears a link -- it keeps the current one and
 * reports -- while an explicit "no nurse" clears only a nurse HHAeXchange set.
 *
 * A person is linked only while active (linkEligibilityUtils). Until then the
 * patient waits for them: the pending id is stored, an admin may put someone
 * else on the patient, and the person is reported once, not once per patient.
 */

const {
  HHAX_COORDINATOR_MATCH_KINDS,
  HHAX_SYNC_EXCEPTION_TYPES,
} = require('../../constants/hhaExchangeConstants');

const COORDINATOR_EXCEPTION_BY_KIND = {
  [HHAX_COORDINATOR_MATCH_KINDS.UNKNOWN]:
    HHAX_SYNC_EXCEPTION_TYPES.UNKNOWN_COORDINATOR_NAME,
  [HHAX_COORDINATOR_MATCH_KINDS.AMBIGUOUS]:
    HHAX_SYNC_EXCEPTION_TYPES.AMBIGUOUS_COORDINATOR_NAME,
};

/** "nurseProfileId:regionId" -- the key secondaryCoverage is built with. */
const buildCoverageKey = ({nurseProfileId, regionId}) =>
  `${nurseProfileId}:${regionId}`;

/** Put `value` on the patch only when the stored row differs. */
const setIfChanged = ({patch, current, field, value}) => {
  if ((current[field] ?? null) !== value) patch[field] = value;
};

/** A holder the lookup knows and no longer finds active; unknown is not inactive. */
const isHolderInactive = ({holderId, byProfileId}) => {
  const holder = holderId ? byProfileId.get(holderId) : null;

  return Boolean(holder) && !holder.isEligible;
};

const planCounty = ({entry, current, patch}) => {
  // undefined = the run could not resolve counties at all; leave them alone.
  if (entry.countyId === undefined) return;

  if (!entry.countyId) {
    if (current.isCountyHhaManaged) patch.isCountyHhaManaged = false;

    return;
  }

  if (current.countyId !== entry.countyId) patch.countyId = entry.countyId;
  if (!current.isCountyHhaManaged) patch.isCountyHhaManaged = true;
};

const planPrimaryNurse = ({entry, current, nurseLookup, patch}) => {
  const exceptions = [];

  if (!nurseLookup || !entry.nurseRef.isKnown) return exceptions;

  const {hhaNurseId} = entry.nurseRef;
  const isManaged = Boolean(current.isPrimaryNurseHhaManaged);
  const hhaNurse = hhaNurseId ? nurseLookup.byHhaId.get(hhaNurseId) : null;
  const isWaiting = Boolean(hhaNurse) && !hhaNurse.isEligible;

  setIfChanged({
    patch,
    current,
    field: 'hhaPendingNurseProfileId',
    value: isWaiting ? hhaNurse.profileId : null,
  });

  if (!hhaNurseId) {
    // Only a nurse HHAeXchange named is cleared; an admin's pick stays.
    if (isManaged) {
      patch.isPrimaryNurseHhaManaged = false;

      if (current.primaryNurseProfileId) patch.primaryNurseProfileId = null;
    }

    if (current.hhaDeclinedNurseId) patch.hhaDeclinedNurseId = null;

    return exceptions;
  }

  if (!hhaNurse) {
    if (isManaged) patch.isPrimaryNurseHhaManaged = false;

    exceptions.push({
      type: HHAX_SYNC_EXCEPTION_TYPES.UNKNOWN_HHA_NURSE,
      detail: hhaNurseId,
    });

    return exceptions;
  }

  if (isWaiting) {
    // The flag is left alone on a kept nurse: it is what later tells a
    // leftover HHA nurse (replaced silently) from an admin's pick (asked).
    const isLinkDropped =
      isManaged &&
      isHolderInactive({
        holderId: current.primaryNurseProfileId,
        byProfileId: nurseLookup.byProfileId,
      });

    if (isLinkDropped) {
      patch.primaryNurseProfileId = null;
      patch.isPrimaryNurseHhaManaged = false;
    }

    return exceptions;
  }

  const isAdminPick =
    !isManaged &&
    Boolean(current.primaryNurseProfileId) &&
    current.primaryNurseProfileId !== hhaNurse.profileId;

  if (isAdminPick) {
    if (current.hhaDeclinedNurseId !== hhaNurseId) {
      exceptions.push({
        type: HHAX_SYNC_EXCEPTION_TYPES.PRIMARY_NURSE_CONFLICT,
        detail: hhaNurseId,
        relatedUserId: hhaNurse.userId,
      });
    }

    return exceptions;
  }

  if (current.primaryNurseProfileId !== hhaNurse.profileId) {
    patch.primaryNurseProfileId = hhaNurse.profileId;
  }

  if (!isManaged) patch.isPrimaryNurseHhaManaged = true;
  if (current.hhaDeclinedNurseId) patch.hhaDeclinedNurseId = null;

  return exceptions;
};

/**
 * The secondary nurse is admin-owned, but sync must still clear it when it now
 * equals the primary (a DB CHECK) or no longer covers a county sync just moved.
 */
const planSecondaryNurse = ({entry, current, secondaryCoverage, patch}) => {
  const secondary = current.secondaryNurseProfileId;

  if (!secondary) return [];

  const primary =
    patch.primaryNurseProfileId === undefined
      ? current.primaryNurseProfileId
      : patch.primaryNurseProfileId;

  if (secondary === primary) {
    patch.secondaryNurseProfileId = null;

    return [{type: HHAX_SYNC_EXCEPTION_TYPES.SECONDARY_NURSE_MATCHES_PRIMARY}];
  }

  // A null coverage set means the lookup failed: leave the secondary alone.
  if (!patch.countyId || !secondaryCoverage) return [];

  const isCovered = secondaryCoverage.has(
    buildCoverageKey({nurseProfileId: secondary, regionId: entry.regionId})
  );

  if (!isCovered) {
    patch.secondaryNurseProfileId = null;

    return [{type: HHAX_SYNC_EXCEPTION_TYPES.SECONDARY_NURSE_REGION_MISMATCH}];
  }

  return [];
};

/** The coordinator an admin chose, while HHA still lists it and it is active. */
const findSelectedCoordinator = ({coordinators, selectedProfileId}) =>
  selectedProfileId
    ? coordinators.find(
        ({match}) =>
          match && !match.isDeleted && match.profileId === selectedProfileId
      ) || null
    : null;

/** The next active coordinator in HHA's order, used while `top` cannot be. */
const findFallbackCoordinator = ({coordinators, top}) =>
  coordinators.find(
    ({kind, match}) =>
      kind === HHAX_COORDINATOR_MATCH_KINDS.MATCHED &&
      match.isEligible &&
      match.profileId !== top.profileId
  )?.match || null;

/**
 * HHA's case manager `top` is active. It takes the patient unless someone was
 * chosen instead: an admin's pick, or the fallback used while `top` was waited
 * for. Then the holder stays and the admin is asked, once per declined `top`.
 *
 * @returns {{nextHolder: string|null, exceptions: Object[]}}
 */
const planActiveCaseManager = ({
  top,
  coordinators,
  current,
  holder,
  casePatch,
}) => {
  const isWaitedFor = current.hhaPendingCaseManagerProfileId === top.profileId;

  const isFallback =
    isWaitedFor && coordinators.some(({match}) => match?.profileId === holder);

  const isChosenInstead =
    Boolean(holder) &&
    holder !== top.profileId &&
    (!current.isCaseManagerHhaManaged || isFallback);

  const setCaseField = ({field, value}) =>
    setIfChanged({patch: casePatch, current, field, value});

  if (!isChosenInstead) {
    setCaseField({field: 'hhaPendingCaseManagerProfileId', value: null});
    setCaseField({field: 'hhaDeclinedCaseManagerProfileId', value: null});
    setCaseField({field: 'isCaseManagerHhaManaged', value: true});

    return {nextHolder: top.profileId, exceptions: []};
  }

  if (current.hhaDeclinedCaseManagerProfileId === top.profileId) {
    setCaseField({field: 'hhaPendingCaseManagerProfileId', value: null});

    return {nextHolder: holder, exceptions: []};
  }

  // Kept only while it names `top`: that is what marks the holder a fallback.
  if (!isWaitedFor) {
    setCaseField({field: 'hhaPendingCaseManagerProfileId', value: null});
  }

  return {
    nextHolder: holder,
    exceptions: [
      {
        type: HHAX_SYNC_EXCEPTION_TYPES.CASE_MANAGER_CONFLICT,
        detail: top.hhaId,
        relatedUserId: top.userId,
      },
    ],
  };
};

/**
 * HHA's case manager `top` cannot be linked yet. The patient waits for them:
 * a link the sync made to someone no longer active is dropped, and the next
 * active coordinator stands in unless an admin's pick is on the patient.
 *
 * @returns {{nextHolder: string|null, exceptions: Object[]}}
 */
const planWaitingCaseManager = ({
  top,
  coordinators,
  current,
  holder,
  caseManagerByProfileId,
  casePatch,
}) => {
  const isManaged = Boolean(current.isCaseManagerHhaManaged);

  const setCaseField = ({field, value}) =>
    setIfChanged({patch: casePatch, current, field, value});

  setCaseField({
    field: 'hhaPendingCaseManagerProfileId',
    value: top.profileId,
  });

  const isLinkDropped =
    isManaged &&
    isHolderInactive({holderId: holder, byProfileId: caseManagerByProfileId});

  const kept = isLinkDropped ? null : holder;
  const fallback = findFallbackCoordinator({coordinators, top});

  if (fallback && (!kept || isManaged)) {
    setCaseField({field: 'isCaseManagerHhaManaged', value: true});

    return {nextHolder: fallback.profileId, exceptions: []};
  }

  if (!kept) setCaseField({field: 'isCaseManagerHhaManaged', value: false});

  return {nextHolder: kept, exceptions: []};
};

/**
 * The admin's pick among HHA's coordinators wins while it holds; otherwise
 * HHA's first coordinator.
 *
 * @returns {{caseManagerProfileId: string|null, removeCaseManager: boolean,
 *   casePatch: Object, isSelectionStale: boolean, exceptions: Object[]}}
 *   caseManagerProfileId is set only when the link moves; casePatch holds the
 *   patient columns to write.
 */
const planCaseManager = ({
  coordinators,
  current,
  currentCaseManagerProfileId,
  caseManagerByProfileId,
}) => {
  const casePatch = {};
  const holder = currentCaseManagerProfileId || null;
  const selectedProfileId = current.hhaSelectedCaseManagerProfileId;

  const keep = ({exceptions = [], isSelectionStale = false}) => ({
    caseManagerProfileId: null,
    removeCaseManager: false,
    casePatch,
    isSelectionStale,
    exceptions,
  });

  // null = the run could not resolve coordinators; leave the link alone.
  if (!coordinators) return keep({});

  const selected = findSelectedCoordinator({coordinators, selectedProfileId});

  const ambiguous = coordinators.find(
    ({kind}) => kind === HHAX_COORDINATOR_MATCH_KINDS.AMBIGUOUS
  );

  // The pick may be the one that could not be told apart: keep it and the link.
  if (selectedProfileId && !selected && ambiguous) {
    return keep({
      exceptions: [
        {
          type: HHAX_SYNC_EXCEPTION_TYPES.AMBIGUOUS_COORDINATOR_NAME,
          detail: ambiguous.name || null,
        },
      ],
    });
  }

  const isSelectionStale = Boolean(selectedProfileId) && !selected;

  const staleExceptions = isSelectionStale
    ? [{type: HHAX_SYNC_EXCEPTION_TYPES.SELECTED_COORDINATOR_REMOVED}]
    : [];

  const coordinator = selected || coordinators[0];

  if (
    !coordinator ||
    coordinator.kind === HHAX_COORDINATOR_MATCH_KINDS.UNKNOWN
  ) {
    // HHA names nobody we can wait for.
    setIfChanged({
      patch: casePatch,
      current,
      field: 'hhaPendingCaseManagerProfileId',
      value: null,
    });
  }

  if (!coordinator) {
    return keep({
      isSelectionStale,
      exceptions: staleExceptions.concat([
        {type: HHAX_SYNC_EXCEPTION_TYPES.NO_HHA_COORDINATOR},
      ]),
    });
  }

  if (coordinator.kind !== HHAX_COORDINATOR_MATCH_KINDS.MATCHED) {
    return keep({
      isSelectionStale,
      exceptions: staleExceptions.concat([
        {
          type: COORDINATOR_EXCEPTION_BY_KIND[coordinator.kind],
          detail: coordinator.name || null,
        },
      ]),
    });
  }

  const top = coordinator.match;

  const {nextHolder, exceptions} = top.isEligible
    ? planActiveCaseManager({top, coordinators, current, holder, casePatch})
    : planWaitingCaseManager({
        top,
        coordinators,
        current,
        holder,
        caseManagerByProfileId,
        casePatch,
      });

  return {
    caseManagerProfileId:
      nextHolder && nextHolder !== holder ? nextHolder : null,
    removeCaseManager: Boolean(holder) && !nextHolder,
    casePatch,
    isSelectionStale,
    exceptions: staleExceptions.concat(exceptions),
  };
};

/**
 * @param {Object} params
 * @param {Object} params.entry - Prepared feed record: countyId, regionId,
 *   nurseRef.
 * @param {Object} params.current - The stored patient row.
 * @param {Object[]|null} params.coordinators - [{kind, match, name}] in HHA's
 *   order from the resolver; null skips the case manager.
 * @param {string|null} params.currentCaseManagerProfileId
 * @param {{byHhaId: Map, byProfileId: Map}|null} params.nurseLookup - HHA
 *   nurses as {profileId, userId, hhaId, isEligible}; null skips nurses.
 * @param {Map|null} params.caseManagerByProfileId - HHA case managers by
 *   profile id, same shape as a coordinator match.
 * @param {Set|null} params.secondaryCoverage - SECONDARY "nurse:region" keys;
 *   null when the lookup failed.
 * @returns {{patch: Object, caseManagerProfileId: string|null,
 *   removeCaseManager: boolean, exceptions: Object[]}}
 *   caseManagerProfileId is set only when the link must change.
 */
const planPatientLinks = ({
  entry,
  current,
  coordinators,
  currentCaseManagerProfileId,
  nurseLookup,
  caseManagerByProfileId,
  secondaryCoverage,
}) => {
  const patch = {};

  planCounty({entry, current, patch});

  // An archived patient keeps its county current but acquires no links.
  if (current.isDeleted) {
    return {
      patch,
      caseManagerProfileId: null,
      removeCaseManager: false,
      exceptions: [],
    };
  }

  const nurseExceptions = planPrimaryNurse({
    entry,
    current,
    nurseLookup,
    patch,
  });

  const secondaryExceptions = planSecondaryNurse({
    entry,
    current,
    secondaryCoverage,
    patch,
  });

  const {
    caseManagerProfileId,
    removeCaseManager,
    casePatch,
    isSelectionStale,
    exceptions: caseManagerExceptions,
  } = planCaseManager({
    coordinators,
    current,
    currentCaseManagerProfileId,
    caseManagerByProfileId: caseManagerByProfileId || new Map(),
  });

  Object.assign(patch, casePatch);

  if (isSelectionStale) patch.hhaSelectedCaseManagerProfileId = null;

  return {
    patch,
    caseManagerProfileId,
    removeCaseManager,
    exceptions: nurseExceptions
      .concat(secondaryExceptions)
      .concat(caseManagerExceptions),
  };
};

module.exports = {buildCoverageKey, planPatientLinks};
