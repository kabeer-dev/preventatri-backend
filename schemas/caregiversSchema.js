const Yup = require('yup');

const {validatorUtils, safeMerge} = require('../utils');
const commonCaregiverValidations = require('./commonCaregiverValidations');

const {
  notesSchema,
  commonListFiltersSchema,
} = require('./commonEntityValidations');

const {
  commonPaginationSchema,
  commonUserSchema,
  commonUserUpdateSchema,
  commonSchema,
  preferredContactMethodSchema,
} = require('./commonSchema');
const {SYSTEM_ENTITIES} = require('../constants/aclConstants');

const {
  CAREGIVERS_SORT_FIELDS_VALUES,
} = require('../constants/caregiversConstants');

const {SORT_ORDERS_VALUES} = require('../constants/generalConstant');

const {caregiverStatusSchema} = commonCaregiverValidations;

const commonFieldsSchema = commonSchema();

/**
 * Caregiver address fields.
 *
 * They live on `users`, not on caregiver_profiles -- a CaregiverProfile is a
 * User satellite -- but they are edited through the caregiver endpoints, so
 * they are validated here and the controller routes them to the user row.
 */
const caregiverAddressSchema = () => ({
  address: commonFieldsSchema.address(),
  city: commonFieldsSchema.city(),
  state: commonFieldsSchema.state(),
  zipCode: commonFieldsSchema.zipCode(),
});

// ✉️ Invite Caregiver (Create new caregiver with all required fields)
module.exports.validateCaregiverInviteRequest = ({data}) => {
  const inviteSchema = Yup.object().shape(
    safeMerge({
      originalObj: safeMerge({
        originalObj: commonUserSchema,
        newObj: caregiverAddressSchema(),
      }),
      newObj: {
        // CaregiverProfile fields (required)
        role: commonCaregiverValidations.roleSchema({required: true}),

        // Optional CaregiverProfile fields
        status: caregiverStatusSchema({
          withDefault: true,
        }),
        relationshipToPatient:
          commonCaregiverValidations.relationshipToPatientSchema(),
        preferredContactMethod: preferredContactMethodSchema({nullable: true}),
        language: commonCaregiverValidations.languageSchema(),
        notes: notesSchema(),
        startDate: Yup.date().nullable(),
        terminationDate: Yup.date().nullable(),
        onCallIndicator: Yup.boolean(),

        // Optional patient assignments
        patientIds: commonCaregiverValidations.patientIdsSchema(),
      },
    })
  );

  return validatorUtils.validate({schema: inviteSchema, data});
};

// 🔄 Update Caregiver Profile
module.exports.validateCaregiverProfileUpdateRequest = ({data}) => {
  const updateSchema = Yup.object()
    .shape(
      safeMerge({
        originalObj: safeMerge({
          originalObj: commonUserUpdateSchema,
          newObj: safeMerge({
            originalObj: caregiverAddressSchema(),

            // Email is NOT part of commonUserUpdateSchema, which nurses and
            // case managers also use -- it is accepted only here, and the
            // controller lets it through only while the stored address is still
            // the placeholder the HHAeXchange sync minted. That is the sole
            // correction path for a caregiver HHAeXchange had no email for.
            newObj: {email: commonFieldsSchema.email()},
          }),
        }),
        newObj: {
          // CaregiverProfile fields (optional updates)
          role: commonCaregiverValidations.roleSchema(),
          status: caregiverStatusSchema(),
          relationshipToPatient:
            commonCaregiverValidations.relationshipToPatientSchema({
              nullable: true,
            }),
          preferredContactMethod: preferredContactMethodSchema({
            nullable: true,
          }),
          language: commonCaregiverValidations.languageSchema({nullable: true}),
          notes: notesSchema({nullable: true}),
          startDate: Yup.date().nullable(),
          terminationDate: Yup.date().nullable(),
          onCallIndicator: Yup.boolean(),
        },
      })
    )
    .test(
      'at-least-one-field',
      'At least one field must be provided for update',
      (value) => {
        if (!value || typeof value !== 'object') return false;

        return Object.keys(value).some((key) => value[key] !== undefined);
      }
    );

  return validatorUtils.validate({schema: updateSchema, data});
};

// 🆔 Validate Caregiver ID Params
module.exports.validateCaregiverIdParams = ({data}) => {
  const idSchema = Yup.object().shape({
    id: validatorUtils.uuidValidate({
      name: SYSTEM_ENTITIES.caregiver.label,
    }),
  });

  return validatorUtils.validate({schema: idSchema, data});
};

// 📊 Caregiver Stats Query Params
// Optional from/to date range; when omitted the stats cover all time.
module.exports.validateCaregiverStatsQuery = ({data}) => {
  const querySchema = Yup.object().shape({
    from: Yup.date().nullable(),
    to: Yup.date()
      .nullable()
      .min(Yup.ref('from'), 'to must be the same as or after from'),
  });

  return validatorUtils.validate({schema: querySchema, data});
};

// 📋 List Caregivers Query Params
module.exports.validateListCaregiversQuery = ({data}) => {
  const paginationBase = commonPaginationSchema({
    sortFieldsValues: CAREGIVERS_SORT_FIELDS_VALUES,
    sortOrdersValues: SORT_ORDERS_VALUES,
  });

  const querySchema = paginationBase.shape(
    safeMerge({
      originalObj: commonListFiltersSchema(),
      newObj: {
        role: commonCaregiverValidations.roleSchema(),

        // Overrides the two-value status filter commonListFiltersSchema
        // supplies, which would reject the four statuses only caregivers have.
        status: caregiverStatusSchema({withAll: true}),
      },
    })
  );

  return validatorUtils.validate({schema: querySchema, data});
};
