/**
 * Whether the sync may link a nurse or case manager to a patient: the profile
 * is Active, not archived, and its user accepted an invitation. The same bar
 * escalations and manual nurse assignment hold people to.
 */

const {ENTITY_STATUSES} = require('../../constants/generalConstant');
const {HHA_LINK_ELIGIBILITY} = require('../../constants/hhaExchangeConstants');

/** What a profile query must select for resolveLinkEligibility. */
const LINK_ELIGIBILITY_SELECT = {
  status: true,
  isDeleted: true,
  user: {select: {isVerified: true}},
};

/** The Prisma filter matching exactly the profiles that are eligible. */
const ELIGIBLE_PROFILE_QUERY = {
  status: ENTITY_STATUSES.ACTIVE.value,
  isDeleted: null,
  user: {isVerified: true},
};

/**
 * @param {Object} params
 * @param {Object} params.profile - {status, isDeleted, user: {isVerified}}.
 * @returns {string} An HHA_LINK_ELIGIBILITY value.
 */
const resolveLinkEligibility = ({profile}) => {
  if (profile.isDeleted || profile.status !== ENTITY_STATUSES.ACTIVE.value) {
    return HHA_LINK_ELIGIBILITY.NOT_ACTIVE;
  }

  return profile.user?.isVerified
    ? HHA_LINK_ELIGIBILITY.ELIGIBLE
    : HHA_LINK_ELIGIBILITY.INVITATION_PENDING;
};

module.exports = {
  ELIGIBLE_PROFILE_QUERY,
  LINK_ELIGIBILITY_SELECT,
  resolveLinkEligibility,
};
