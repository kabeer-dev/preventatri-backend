/**
 * The create-only field filter shared by every HHAeXchange user import.
 *
 * A CaregiverProfile and a CaseManagerProfile are both User satellites, so both
 * reconcilers build a `userFields` object and both must strip the same class of
 * field before it can reach an update payload: values written once at create and
 * never again. `email` is the one that matters -- it is the login identity, it
 * sits under a unique index, and overwriting it on a later run could lock a
 * person out or collide with another account.
 *
 * Exists so that removal happens in ONE place rather than being remembered at
 * each call site, and so the two reconcilers cannot drift on which fields are
 * create-only.
 */

/**
 * @param {Object} params
 * @param {Object} params.fields - The mapped fields for one record.
 * @param {string[]} params.createOnlyFields - Keys an update may not touch.
 * @returns {Object} A copy of `fields` without the create-only keys.
 */
const omitCreateOnlyFields = ({fields, createOnlyFields}) =>
  Object.keys(fields).reduce((updatable, key) => {
    if (!createOnlyFields.includes(key)) {
      updatable[key] = fields[key];
    }

    return updatable;
  }, {});

module.exports = {
  omitCreateOnlyFields,
};
