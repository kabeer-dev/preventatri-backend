const {
  PHONE_NUMBER_STRIP_PATTERN,
  BARE_DIAL_CODE_PATTERN,
} = require('../constants/usersConstants');

/**
 * Normalise a phone number to the shared storage shape: keep the digits and a
 * single leading "+", drop every other character, and collapse empty input or
 * a bare dial code ("+1") to null.
 *
 * Pure -- used by the Yup request schemas (all roles) and by the HHAeXchange
 * field normalisers, so a value that passes the API is byte-identical to the
 * value the sync would have written.
 *
 * @param {Object} params
 * @param {string|null|undefined} params.value
 * @returns {string|null}
 */
const normalizePhoneNumber = ({value}) => {
  if (value === null || value === undefined) return null;

  const compact = String(value).replace(PHONE_NUMBER_STRIP_PATTERN, '');
  const hasLeadingPlus = compact.startsWith('+');
  const digits = compact.replace(/\+/g, '');
  const normalized = hasLeadingPlus ? `+${digits}` : digits;

  if (digits === '' || BARE_DIAL_CODE_PATTERN.test(normalized)) return null;

  return normalized;
};

module.exports = {normalizePhoneNumber};
