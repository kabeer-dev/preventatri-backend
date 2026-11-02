/**
 * Stable fingerprint of the HHAeXchange-owned fields on one record.
 *
 * Extracted from patientMapper so the caregiver reconciler hashes identically.
 * The hash is what gates writes: an unchanged roster produces zero field
 * updates, which is what makes a full nightly pass affordable.
 *
 * Hashing the MAPPED object rather than the raw record is deliberate twice
 * over: the raw record carries dozens of fields we ignore (referral ids, wage
 * parity, payroll, coordinators), so hashing it would force writes on changes we
 * do not store; and because PreventaTri-owned fields are absent from `mapped`,
 * an admin editing `notes` cannot change the hash and trigger a pointless
 * resync.
 */

const {toISOString} = require('./fieldNormalizers');

const {sortObject} = require('../idempotencyUtils');

/**
 * Replaces Date values with a UTC ISO string so they survive hashing.
 *
 * sortObject walks own enumerable keys, and a Date has none -- it collapses to
 * `{}`. Every date therefore hashed identically, so a corrected date of birth
 * changed nothing in the fingerprint and the record was never re-synced.
 *
 * `omitFields` drops keys the hash-gated update never writes (the email, which
 * reconcileHhaEmails handles), so a change to one cannot fire an empty update.
 */
const toHashableFields = ({mapped, omitFields = []}) =>
  Object.keys(mapped).reduce((hashable, key) => {
    if (omitFields.includes(key)) return hashable;

    const value = mapped[key];

    hashable[key] = value instanceof Date ? toISOString({date: value}) : value;

    return hashable;
  }, {});

/**
 * @param {Object} params
 * @param {Object} params.mapped - The HHAeXchange-owned fields for one record.
 * @param {string[]} [params.omitFields] - Keys excluded from the fingerprint.
 * @returns {string} A 64-char sha256 hex digest, sized for hha_sync_hash.
 */
const computeSyncHash = ({mapped, omitFields = []}) => {
  // Required lazily so the module stays trivially importable in tests.
  const {createHash} = require('crypto');

  return createHash('sha256')
    .update(
      JSON.stringify(sortObject({obj: toHashableFields({mapped, omitFields})}))
    )
    .digest('hex');
};

module.exports = {
  toHashableFields,
  computeSyncHash,
};
