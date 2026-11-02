/**
 * Synthetic login identities for HHAeXchange imports.
 *
 * HHAeXchange treats a person's email as optional, but User.email is NOT NULL
 * and unique per organization. Rather than dropping a real caregiver or case
 * manager over a missing address, a synthetic one is minted on the RFC 2606
 * reserved `.invalid` domain, which can never resolve.
 *
 * Sync itself never sends mail -- the invitation is a separate call the invite
 * controllers make and sync does not -- so a placeholder is inert until an admin
 * replaces it, which the update controllers allow only while the stored address
 * still ends in this domain.
 *
 * Shared by the caregiver and coordinator mappers rather than duplicated: the
 * rule (mint on `.invalid`, allow exactly one correction) is identical for both
 * roles and must not drift. Only the local-part prefix differs, because
 * HHAeXchange numbers caregivers and coordinators independently -- caregiver
 * 4870049 and coordinator 4870049 are different people, and one shared prefix
 * would mint the same address for both and collide on the per-org unique index.
 */

const {toTrimmed} = require('./fieldNormalizers');

const {
  HHAX_FIELD_MAX_LENGTHS,
  HHAX_PLACEHOLDER_EMAIL_DOMAIN,
} = require('../../constants/hhaExchangeConstants');

/**
 * The login identity for one imported record.
 *
 * @param {Object} params
 * @param {*} params.email - The raw address HHAeXchange sent, if any.
 * @param {string} params.prefix - An HHAX_PLACEHOLDER_EMAIL_PREFIXES value.
 * @param {string} params.hhaId - The record's HHAeXchange id.
 * @returns {string} The real address, lower-cased, or a synthetic one.
 */
const buildHhaPlaceholderEmail = ({email, prefix, hhaId}) => {
  const normalized = toTrimmed({
    value: email,
    maxLength: HHAX_FIELD_MAX_LENGTHS.EMAIL,
  });

  if (normalized) return normalized.toLowerCase();

  return `${prefix}${hhaId}@${HHAX_PLACEHOLDER_EMAIL_DOMAIN}`;
};

/**
 * Whether an address is still the synthetic one sync minted.
 *
 * Domain-only, deliberately: it must answer true for every imported role, and
 * the domain is the part no real inbox can ever have.
 */
const isPlaceholderEmail = ({email}) =>
  typeof email === 'string' &&
  email.toLowerCase().endsWith(`@${HHAX_PLACEHOLDER_EMAIL_DOMAIN}`);

module.exports = {
  buildHhaPlaceholderEmail,
  isPlaceholderEmail,
};
