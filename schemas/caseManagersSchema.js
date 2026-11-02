const Yup = require('yup');

const {validatorUtils, safeMerge} = require('../utils');

const {
  entityStatusSchema: caseManagerStatusSchema,
  regionIdsSchema,
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

const commonFieldsSchema = commonSchema();

const patientIdsSchema = ({required = false} = {}) => {
  let schema = Yup.array().of(validatorUtils.uuidValidate({name: 'Patient'}));

  schema = schema.test(
    'unique-patient-ids',
    'Patient IDs must be unique — duplicate assignments are not allowed',
    (value) => {
      if (!value || value.length === 0) return true;

      return new Set(value).size === value.length;
    }
  );

  return required ? schema.required('Patient assignment is required') : schema;
};

const {
  accessConstants: {SYSTEM_ENTITIES},
} = require('../constants');

const {
  CASE_MANAGERS_SORT_FIELDS_VALUES,
} = require('../constants/caseManagersConstants');

const {SORT_ORDERS_VALUES} = require('../constants/generalConstant');
const {toDateOnlyUTC, todayUTC} = require('../utils/dateUtils');

// ✉️ Invite Case Manager
module.exports.validateCaseManagerInviteRequest = ({data}) => {
  const inviteSchema = Yup.object().shape(
    safeMerge({
      originalObj: commonUserSchema,
      newObj: {
        // CaseManagerProfile fields
        status: caseManagerStatusSchema({
          withDefault: true,
        }),
        preferredContactMethod: preferredContactMethodSchema(),
        language: Yup.string().trim().max(10).notRequired(),
        startDate: Yup.date()
          .typeError('Start date must be a valid date')
          .nullable()
          .transform((value, originalValue) => {
            if (!originalValue) return value;

            return toDateOnlyUTC({date: originalValue});
          })
          .test('not-in-past', 'Start date cannot be in the past', (value) => {
            if (!value) return true;

            return value >= todayUTC().toJSDate();
          }),
        title: Yup.string().trim().max(100).notRequired(),
        notes: notesSchema(),

        // Region assignments (required)
        regionIds: regionIdsSchema({required: true}),

        // Patient assignments (optional)
        patientIds: patientIdsSchema(),
      },
    })
  );

  return validatorUtils.validate({schema: inviteSchema, data});
};

// 🔄 Update Case Manager Profile
module.exports.validateCaseManagerProfileUpdateRequest = ({data}) => {
  const updateSchema = Yup.object()
    .shape(
      safeMerge({
        originalObj: safeMerge({
          originalObj: commonUserUpdateSchema,

          // Email is NOT part of commonUserUpdateSchema, which nurses also use
          // -- it is accepted here (as on caregivers) only so the controller can
          // let it through while the stored address is still the placeholder the
          // HHAeXchange sync minted. That is the sole correction path for a
          // coordinator HHAeXchange had no email for; on every other case
          // manager the controller refuses it.
          newObj: {email: commonFieldsSchema.email()},
        }),
        newObj: {
          // CaseManagerProfile fields (optional updates)
          status: caseManagerStatusSchema(),
          preferredContactMethod: preferredContactMethodSchema({
            nullable: true,
          }),
          language: Yup.string().trim().max(10).nullable(),
          startDate: Yup.date()
            .typeError('Start date must be a valid date')
            .nullable()
            .transform((value, originalValue) => {
              if (!originalValue) return value;

              return toDateOnlyUTC({date: originalValue});
            }),
          title: Yup.string().trim().max(100).nullable(),
          notes: notesSchema({nullable: true}),

          // Region assignments (optional update)
          regionIds: regionIdsSchema(),

          // Patient assignments (optional update — IDs must be unique)
          patientIds: patientIdsSchema(),
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

// 🆔 Validate Case Manager ID Params
module.exports.validateCaseManagerIdParams = ({data}) => {
  const idSchema = Yup.object().shape({
    id: validatorUtils.uuidValidate({
      name: SYSTEM_ENTITIES.caseManager.label,
    }),
  });

  return validatorUtils.validate({schema: idSchema, data});
};

// 🏥 Available Patients Query Params
module.exports.validateAvailablePatientsQuery = ({data}) => {
  const schema = Yup.object().shape({
    regionIds: Yup.string().trim().notRequired(),
    caseManagerProfileId: validatorUtils
      .uuidValidate({name: 'Case Manager Profile'})
      .notRequired(),
  });

  return validatorUtils.validate({schema, data});
};

// 📊 Case Manager Admin Stats Query Params — from/to are optional; omitting
// both means the org-wide case manager metrics are counted over all time.
module.exports.validateCaseManagerAdminStatsQuery = ({data}) => {
  const querySchema = Yup.object().shape({
    from: Yup.date().typeError('from must be a valid date'),
    to: Yup.date()
      .typeError('to must be a valid date')
      .min(Yup.ref('from'), 'to must be the same as or after from'),
  });

  return validatorUtils.validate({schema: querySchema, data});
};

// 📋 List Case Managers Query Params
module.exports.validateListCaseManagersQuery = ({data}) => {
  const paginationBase = commonPaginationSchema({
    sortFieldsValues: CASE_MANAGERS_SORT_FIELDS_VALUES,
    sortOrdersValues: SORT_ORDERS_VALUES,
  });

  const querySchema = paginationBase.shape(
    commonListFiltersSchema({withRegionId: true, withIsVerified: true})
  );

  return validatorUtils.validate({schema: querySchema, data});
};
