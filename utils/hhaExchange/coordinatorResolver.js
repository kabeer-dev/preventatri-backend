/**
 * Coordinator name / id -> HHA case manager, for the patient link sync.
 *
 * The patient feed names a patient's coordinator as TEXT, so names are matched
 * against the synced case managers' stored "first last". A name two case
 * managers share resolves to AMBIGUOUS rather than to whichever came last; the
 * caller then asks GetPatientDemographics for the coordinator's id.
 *
 * Pure: the caller supplies the profiles.
 */

const {normalizeCoordinatorName} = require('./coordinatorMapper');
const {resolveLinkEligibility} = require('./linkEligibilityUtils');

const {HHA_LINK_ELIGIBILITY} = require('../../constants/hhaExchangeConstants');

/** Stored against a name more than one case manager answers to. */
const AMBIGUOUS_COORDINATOR = Object.freeze({ambiguous: true});

/**
 * @param {Object} params
 * @param {Object[]} params.profiles - {id, userId, hhaCoordinatorId, status,
 *   isDeleted, user: {firstName, lastName, isVerified}} for the org's HHA
 *   case managers.
 * @returns {{byName: Map, byHhaId: Map, byProfileId: Map}}
 */
const buildCoordinatorLookup = ({profiles}) => {
  const byName = new Map();
  const byHhaId = new Map();
  const byProfileId = new Map();

  for (const profile of profiles || []) {
    const eligibility = resolveLinkEligibility({profile});

    const match = {
      profileId: profile.id,
      userId: profile.userId,
      hhaId: profile.hhaCoordinatorId || null,
      isDeleted: Boolean(profile.isDeleted),
      eligibility,
      isEligible: eligibility === HHA_LINK_ELIGIBILITY.ELIGIBLE,
    };

    byProfileId.set(profile.id, match);

    if (profile.hhaCoordinatorId) {
      byHhaId.set(String(profile.hhaCoordinatorId), match);
    }

    const name = normalizeCoordinatorName({
      name: [profile.user?.firstName, profile.user?.lastName]
        .filter(Boolean)
        .join(' '),
    });

    if (!name) continue;

    const existing = byName.get(name);

    byName.set(
      name,
      existing && existing.profileId !== profile.id
        ? AMBIGUOUS_COORDINATOR
        : match
    );
  }

  return {byName, byHhaId, byProfileId};
};

/**
 * @returns {{isAmbiguous: boolean, match: Object|null}} match is a
 *   buildCoordinatorLookup entry.
 */
const resolveCoordinatorName = ({lookup, name}) => {
  const found = name ? lookup.byName.get(name) : undefined;

  if (found === AMBIGUOUS_COORDINATOR) return {isAmbiguous: true, match: null};

  return {isAmbiguous: false, match: found || null};
};

module.exports = {
  AMBIGUOUS_COORDINATOR,
  buildCoordinatorLookup,
  resolveCoordinatorName,
};
