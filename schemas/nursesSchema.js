const Yup = require('yup');

const {validatorUtils, safeMerge} = require('../utils');

const {
  entityStatusSchema: nurseStatusSchema,
  notesSchema,
  regionIdsSchema,
  commonListFiltersSchema,
} = require('./commonEntityValidations');
const commonNurseValidations = require('./commonNurseValidations');

const {
  commonPaginationSchema,
  commonUserSchema,
  commonUserUpdateSchema,
  commonSchema,
  preferredContactMethodSchema,
} = require('./commonSchema');

const {modelConstants} = require('../constants');
const {SORT_ORDERS_VALUES} = require('../constants/generalConstant');

const {
  NURSES_SORT_FIELDS_VALUES,
  NURSE_REGION_ROLES,
} = require('../constants/nursesConstants');

const NURSE_REGION_ROLE_VALUES = Object.values(NURSE_REGION_ROLES);

const commonFieldsSchema = commonSchema();

/**
 * Nurse address fields.
 *
 * They live on `users`, not on nurse_profiles -- a NurseProfile is a User
 * satellite -- but they are edited through the nurse endpoints, so they are
 * validated here and the controller routes them to the user row. Same shape
 * as the caregiver address.
 */
const nurseAddressSchema = () => ({
  address: commonFieldsSchema.address(),
  city: commonFieldsSchema.city(),
  state: commonFieldsSchema.state(),
  zipCode: commonFieldsSchema.zipCode(),
});

// Shared test: primary and secondary region IDs must not overlap.
// Skips when either list is missing (PATCH semantics) — per-field required
// rules handle the "must be provided" case independently.
const uniquePrimarySecondaryRegionsTest = {
  name: 'unique-primary-secondary-regions',
  message: 'Primary and secondary region IDs must be unique',
  test: (value) => {
    const primaryRegionIds = value?.primaryRegionIds;
    const secondaryRegionIds = value?.secondaryRegionIds;

    if (!primaryRegionIds || !secondaryRegionIds) return true;

    const primaryRegionIdSet = new Set(primaryRegionIds);

    return !secondaryRegionIds.some((regionId) =>
      primaryRegionIdSet.has(regionId)
    );
  },
};

// Shared NurseProfile field shape used by both invite (create) and update.
// Everything is required on invite, where the FE submits the full object.
// Update is a PATCH: the FE omits the HHAeXchange-managed fields (including
// professionalRole) on an imported nurse, and an admin may legitimately send
// only an email or an address, so on update a field is validated only when it
// is present. The two licence fields are the same story with one more reason:
// an HHAeXchange import cannot supply them (see the migration that made them
// nullable). A given expiration date must still be a future date.
const buildNurseProfileShape = ({isInvite}) => ({
  professionalRole: commonNurseValidations.professionalRoleSchema({
    required: isInvite,
  }),
  licenseNumber: commonNurseValidations
    .licenseNumberSchema({required: isInvite})
    .nullable(),
  licenseState: commonNurseValidations.licenseStateSchema({withDefault: true}),
  licenseExpirationDate: commonNurseValidations
    .licenseExpirationDateSchema({
      required: isInvite,
      mustBeFuture: true,
    })
    .nullable(),

  // Defaulted on invite only: on a PATCH the injected ACTIVE counted as an edit
  // of an HHA-managed field, so every save of an imported nurse was refused.
  status: nurseStatusSchema({withDefault: isInvite}),
  primaryRegionIds: regionIdsSchema({
    required: isInvite,
    fieldLabel: 'primary region',
  }),
  secondaryRegionIds: regionIdsSchema({
    required: isInvite,
    fieldLabel: 'secondary region',
  }),
  npi: commonNurseValidations.npiSchema({nullable: true}),
  onCallIndicator: Yup.boolean(),
  preferredContactMethod: preferredContactMethodSchema({nullable: true}),
  notes: notesSchema({nullable: true}),
  joiningDate: Yup.date().nullable(),
});

// 📋 Invite Nurse (Create new nurse with all required fields)
module.exports.validateNurseInviteRequest = ({data}) => {
  const inviteSchema = Yup.object()
    .shape(
      safeMerge({
        originalObj: safeMerge({
          originalObj: commonUserSchema,
          newObj: nurseAddressSchema(),
        }),
        newObj: buildNurseProfileShape({isInvite: true}),
      })
    )
    .test(uniquePrimarySecondaryRegionsTest);

  return validatorUtils.validate({schema: inviteSchema, data});
};

// 🔄 Update Nurse Profile (Professional info, status, optional fields)
//
// `email` is accepted here for ONE case: replacing the placeholder address the
// HHAeXchange sync minted for a nurse it had no email for. The controller lets
// it through only while the stored address is still that placeholder.
module.exports.validateNurseProfileUpdateRequest = ({data}) => {
  const updateSchema = Yup.object()
    .shape(
      safeMerge({
        originalObj: safeMerge({
          originalObj: safeMerge({
            originalObj: commonUserUpdateSchema,
            newObj: {email: commonFieldsSchema.email()},
          }),
          newObj: nurseAddressSchema(),
        }),
        newObj: buildNurseProfileShape({isInvite: false}),
      })
    )
    .test(uniquePrimarySecondaryRegionsTest);

  return validatorUtils.validate({schema: updateSchema, data});
};

// 🆔 Validate Nurse ID Params
// Note: Nurses are Users with role 'nurse', so we validate against USER model
module.exports.validateNurseIdParams = ({data}) => {
  const idSchema = Yup.object().shape({
    id: validatorUtils.uuidValidate({name: modelConstants.MODELS.USER}),
  });

  return validatorUtils.validate({schema: idSchema, data});
};

// 📊 Nurse Admin Stats Query Params — from/to are optional; omitting both
// means the org-wide nurse metrics are counted over all time.
module.exports.validateNurseAdminStatsQuery = ({data}) => {
  const querySchema = Yup.object().shape({
    from: Yup.date().typeError('from must be a valid date'),
    to: Yup.date()
      .typeError('to must be a valid date')
      .min(Yup.ref('from'), 'to must be the same as or after from'),
  });

  return validatorUtils.validate({schema: querySchema, data});
};

// 📋 List Nurses Query Params
module.exports.validateListNursesQuery = ({data}) => {
  const paginationBase = commonPaginationSchema({
    sortFieldsValues: NURSES_SORT_FIELDS_VALUES,
    sortOrdersValues: SORT_ORDERS_VALUES,
  });

  const querySchema = paginationBase.shape(
    safeMerge({
      originalObj: commonListFiltersSchema({
        withRegionId: true,
        withIsVerified: true,
      }),
      newObj: {
        // Nurse-specific: when filtering by region, narrow to PRIMARY or
        // SECONDARY nurses for that region. Used by the patient form.
        nurseRegionRole: Yup.string().oneOf(
          NURSE_REGION_ROLE_VALUES,
          `nurseRegionRole must be one of: ${NURSE_REGION_ROLE_VALUES.join(', ')}`
        ),
      },
    })
  );

  return validatorUtils.validate({schema: querySchema, data});
};
