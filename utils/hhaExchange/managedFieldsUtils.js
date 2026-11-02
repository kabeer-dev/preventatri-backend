/**
 * The read-only guard for HHAeXchange-managed fields.
 *
 * HHAeXchange owns a defined set of fields on an imported record and every sync
 * overwrites them. Accepting an edit to one would let the change vanish at the
 * next run with no error and no trace, so it is refused at the door instead.
 *
 * This lives in a util rather than in a controller because there are THREE
 * places that have to enforce it and they must not drift apart:
 *  - the patient update (admin edits a patient),
 *  - the caregiver update (admin edits a caregiver),
 *  - the user profile update (a caregiver edits their OWN name or address).
 *
 * That third one is easy to miss and is the reason this exists. Patients are a
 * standalone model, but a CaregiverProfile is a User satellite, so half of a
 * caregiver's HHAeXchange-managed fields sit on `users` and are reachable
 * through the self-service profile endpoint. Without this check there, a synced
 * caregiver could change their own address and watch it revert overnight.
 *
 * The check belongs here rather than in a Yup schema for the same reason it was
 * never in one for patients: the validator only sees req.body and has no way to
 * know the record's source.
 */

const {
  HHA_MANAGED_PATIENT_FIELDS,
  HHA_MANAGED_PATIENT_LINK_FIELDS,
  HHA_MANAGED_PATIENT_CASE_MANAGER_FIELDS,
  HHA_DERIVED_PATIENT_FIELDS,
  HHA_MANAGED_NURSE_FIELDS,
  HHA_DERIVED_NURSE_FIELDS,
} = require('../../constants/hhaExchangeConstants');
const {HhaExchangeErrorsFactories} = require('../../factories/errors');

/**
 * HHAeXchange's nurse holds the patient. While the patient still waits for
 * that nurse, an admin may put someone else on it.
 */
const isPatientPrimaryNurseLocked = ({patient}) =>
  Boolean(patient?.isPrimaryNurseHhaManaged) &&
  !patient?.hhaPendingNurseProfileId;

/**
 * Editable only while the patient waits for HHAeXchange's case manager, or
 * holds one an admin picked. A patient HHA names nobody for stays read-only.
 */
const isPatientCaseManagerLocked = ({patient, hasCaseManager}) =>
  !patient?.hhaPendingCaseManagerProfileId &&
  (!hasCaseManager || Boolean(patient?.isCaseManagerHhaManaged));

/**
 * A record's managed list: the fixed fields plus each conditional group whose
 * `when` holds. Derived fields are managed only while their ZIP resolves.
 *
 * @param {Object} params
 * @param {string[]} params.baseFields
 * @param {{fields: string[], when: boolean}[]} [params.conditionalFields]
 */
const buildHhaManagedFields = ({baseFields, conditionalFields = []}) =>
  conditionalFields.reduce(
    (fields, group) => (group.when ? fields.concat(group.fields) : fields),
    baseFields
  );

/**
 * Everything the patient update must refuse on this HHA patient. The case
 * manager is not here: its lock depends on the link, which lives in another
 * table (see assertPatientCaseManagerEditable).
 */
const resolvePatientHhaManagedFields = ({patient}) =>
  buildHhaManagedFields({
    baseFields: HHA_MANAGED_PATIENT_FIELDS,
    conditionalFields: [
      {
        fields: HHA_MANAGED_PATIENT_LINK_FIELDS,
        when: isPatientPrimaryNurseLocked({patient}),
      },
      {
        fields: HHA_DERIVED_PATIENT_FIELDS,
        when: Boolean(patient?.isCountyHhaManaged),
      },
    ],
  });

/** Everything the nurse update must refuse on this HHA nurse. */
const resolveNurseHhaManagedFields = ({nurseProfile}) =>
  buildHhaManagedFields({
    baseFields: HHA_MANAGED_NURSE_FIELDS,
    conditionalFields: [
      {
        fields: HHA_DERIVED_NURSE_FIELDS,
        when: Boolean(nurseProfile?.isPrimaryRegionHhaManaged),
      },
    ],
  });

/**
 * The managed fields this body actually tries to set.
 *
 * Only keys actually PRESENT count. An update that omits a field entirely is
 * not an edit to it, and `filterUndefined` drops those downstream anyway —
 * treating `undefined` as an edit would break every partial PATCH.
 *
 * Exported separately so a caller can answer "is this even relevant?" BEFORE
 * paying to look the record up. usersController.updateProfile needs that: it
 * would otherwise run a caregiver-profile query on every password change and
 * every profile edit by every nurse and admin in the system.
 *
 * @param {Object} params
 * @param {Object} params.body - The request body.
 * @param {string[]} params.managedFields - HHA_MANAGED_* field list.
 * @returns {string[]} The managed fields present in the body.
 */
const getEditedHhaManagedFields = ({body, managedFields}) =>
  managedFields.filter((field) => body?.[field] !== undefined);

/**
 * Throw if `body` tries to set any HHAeXchange-managed field on a managed record.
 *
 * A no-op when the record is not HHA-sourced, so callers can invoke it
 * unconditionally rather than wrapping it in their own source check.
 *
 * @param {Object} params
 * @param {Object} params.body - The request body.
 * @param {boolean} params.isHhaManaged - Whether the record came from HHAeXchange.
 * @param {string[]} params.managedFields - HHA_MANAGED_* field list.
 * @throws {AppError} 400 HHA_MANAGED_FIELD_READ_ONLY, naming the fields.
 */
const assertHhaManagedFieldsNotEdited = ({
  body,
  isHhaManaged,
  managedFields,
}) => {
  if (!isHhaManaged) return;

  const blockedFields = getEditedHhaManagedFields({body, managedFields});

  if (blockedFields.length === 0) return;

  throw HhaExchangeErrorsFactories.hhaManagedFieldReadOnlyErr({
    fields: blockedFields,
  });
};

/**
 * Throw unless an admin may set this HHA patient's case manager right now.
 *
 * @throws {AppError} 400 HHA_MANAGED_FIELD_READ_ONLY
 */
const assertPatientCaseManagerEditable = ({patient, hasCaseManager}) => {
  if (!isPatientCaseManagerLocked({patient, hasCaseManager})) return;

  throw HhaExchangeErrorsFactories.hhaManagedFieldReadOnlyErr({
    fields: HHA_MANAGED_PATIENT_CASE_MANAGER_FIELDS,
  });
};

module.exports = {
  assertPatientCaseManagerEditable,
  buildHhaManagedFields,
  isPatientPrimaryNurseLocked,
  resolvePatientHhaManagedFields,
  resolveNurseHhaManagedFields,
  getEditedHhaManagedFields,
  assertHhaManagedFieldsNotEdited,
};
