const Yup = require('yup');

const {validatorUtils, safeConcat} = require('../utils');

const {commonPaginationSchema} = require('./commonSchema');

const {SORT_ORDERS_VALUES} = require('../constants/generalConstant');

const {
  HHA_COORDINATOR_CHOICE_FILTERS_VALUES,
  HHA_EMAIL_CONFLICT_FILTERS_VALUES,
  HHA_PRIMARY_NURSE_CHOICES_VALUES,
  HHAX_FIELD_MAX_LENGTHS,
  HHAX_SYNC_EXCEPTION_TYPES,
  HHAX_SYNC_RESOURCES_VALUES,
  HHAX_SYNC_TRIGGERS_VALUES,
  HHA_SYNC_CHANGE_ACTIONS_VALUES,
  HHA_SYNC_EXCEPTION_ADMIN_STATUSES,
  HHA_SYNC_EXCEPTION_STATUSES_VALUES,
  HHA_SYNC_HISTORY_FILTER_ALL,
  HHA_SYNC_HISTORY_MAX_LENGTHS,
  HHA_SYNC_RUN_STATUSES_VALUES,
} = require('../constants/hhaExchangeConstants');

const {
  HHA_VISIT_FILTER_STATUSES_VALUES,
  HHA_VISIT_STATUS_FILTER_ALL,
  HHA_VISIT_TYPES_VALUES,
  HHA_VISIT_TYPE_FILTER_ALL,
  HHA_VISIT_SORT_FIELDS_VALUES,
  HHA_VISIT_SEARCH_MAX_LENGTH,
} = require('../constants/hhaVisitsConstants');

const HHA_VISIT_ENTITY_LABEL = 'HHAeXchange visit';
const HHA_SYNC_ENTITY_LABEL = 'HHAeXchange sync record';
const USER_ENTITY_LABEL = 'User';
const PATIENT_ENTITY_LABEL = 'Patient';
const CASE_MANAGER_ENTITY_LABEL = 'Case manager';
const REGION_ENTITY_LABEL = 'Region';

// Run ids and HHA record ids are short opaque strings.
const HHA_SYNC_ID_MAX_LENGTH = 64;

// 📋 List HHAeXchange Visits Query Params
//
// Every query param the controller reads MUST be declared here: the validator
// strips anything it does not know about before the request reaches the
// controller.
module.exports.validateListHhaVisitsQuery = ({data}) => {
  const paginationBase = commonPaginationSchema({
    sortFieldsValues: HHA_VISIT_SORT_FIELDS_VALUES,
    sortOrdersValues: SORT_ORDERS_VALUES,
  });

  const statusValues = safeConcat({
    originalArray: HHA_VISIT_FILTER_STATUSES_VALUES,
    newArray: [HHA_VISIT_STATUS_FILTER_ALL],
  });

  const visitTypeValues = safeConcat({
    originalArray: HHA_VISIT_TYPES_VALUES,
    newArray: [HHA_VISIT_TYPE_FILTER_ALL],
  });

  const querySchema = paginationBase.shape({
    search: Yup.string().trim().max(HHA_VISIT_SEARCH_MAX_LENGTH),
    status: Yup.string().oneOf(
      statusValues,
      `Status must be one of: ${statusValues.join(', ')}`
    ),
    visitType: Yup.string().oneOf(
      visitTypeValues,
      `Visit type must be one of: ${visitTypeValues.join(', ')}`
    ),
    dateFrom: Yup.date().typeError('dateFrom must be a valid date'),
    dateTo: Yup.date()
      .typeError('dateTo must be a valid date')
      .when('dateFrom', {
        is: (dateFrom) => Boolean(dateFrom),
        then: (schema) =>
          schema.min(Yup.ref('dateFrom'), 'dateTo cannot be before dateFrom'),
      }),
  });

  return validatorUtils.validate({schema: querySchema, data});
};

// 🆔 Validate HHAeXchange Visit ID Params
module.exports.validateHhaVisitIdParams = ({data}) => {
  const idSchema = Yup.object().shape({
    id: validatorUtils.uuidValidate({name: HHA_VISIT_ENTITY_LABEL}),
  });

  return validatorUtils.validate({schema: idSchema, data});
};

const withAllOption = ({values}) =>
  safeConcat({originalArray: values, newArray: [HHA_SYNC_HISTORY_FILTER_ALL]});

const oneOfFilter = ({values, label}) => {
  const allowed = withAllOption({values});

  return Yup.string().oneOf(
    allowed,
    `${label} must be one of: ${allowed.join(', ')}`
  );
};

const dateRangeShape = () => ({
  dateFrom: Yup.date().typeError('dateFrom must be a valid date'),
  dateTo: Yup.date()
    .typeError('dateTo must be a valid date')
    .when('dateFrom', {
      is: (dateFrom) => Boolean(dateFrom),
      then: (schema) =>
        schema.min(Yup.ref('dateFrom'), 'dateTo cannot be before dateFrom'),
    }),
});

// 🕑 List HHAeXchange Sync Runs Query Params
module.exports.validateListHhaSyncRunsQuery = ({data}) => {
  const querySchema = commonPaginationSchema().shape(
    Object.assign(
      {
        status: oneOfFilter({
          values: HHA_SYNC_RUN_STATUSES_VALUES,
          label: 'Status',
        }),
        trigger: oneOfFilter({
          values: HHAX_SYNC_TRIGGERS_VALUES,
          label: 'Trigger',
        }),
      },
      dateRangeShape()
    )
  );

  return validatorUtils.validate({schema: querySchema, data});
};

// 📝 List HHAeXchange Sync Changes Query Params
module.exports.validateListHhaSyncChangesQuery = ({data}) => {
  const querySchema = commonPaginationSchema().shape(
    Object.assign(
      {
        runId: Yup.string().trim().max(HHA_SYNC_ID_MAX_LENGTH),
        resource: oneOfFilter({
          values: HHAX_SYNC_RESOURCES_VALUES,
          label: 'Resource',
        }),
        action: oneOfFilter({
          values: HHA_SYNC_CHANGE_ACTIONS_VALUES,
          label: 'Action',
        }),
        hhaRecordId: Yup.string().trim().max(HHA_SYNC_ID_MAX_LENGTH),
      },
      dateRangeShape()
    )
  );

  return validatorUtils.validate({schema: querySchema, data});
};

// ⚠️ List HHAeXchange Sync Exceptions Query Params
module.exports.validateListHhaSyncExceptionsQuery = ({data}) => {
  const querySchema = commonPaginationSchema().shape({
    status: oneOfFilter({
      values: HHA_SYNC_EXCEPTION_STATUSES_VALUES,
      label: 'Status',
    }),
    type: oneOfFilter({
      values: Object.values(HHAX_SYNC_EXCEPTION_TYPES),
      label: 'Type',
    }),
    resource: oneOfFilter({
      values: HHAX_SYNC_RESOURCES_VALUES,
      label: 'Resource',
    }),
    runId: Yup.string().trim().max(HHA_SYNC_ID_MAX_LENGTH),
  });

  return validatorUtils.validate({schema: querySchema, data});
};

// 👥 List the Patients Waiting for the Person an Exception Names
module.exports.validateListHhaWaitingPatientsQuery = ({data}) =>
  validatorUtils.validate({schema: commonPaginationSchema(), data});

// 🆔 Validate HHAeXchange Sync Run / Exception ID Params
module.exports.validateHhaSyncIdParams = ({data}) => {
  const idSchema = Yup.object().shape({
    id: validatorUtils.uuidValidate({name: HHA_SYNC_ENTITY_LABEL}),
  });

  return validatorUtils.validate({schema: idSchema, data});
};

// ✅ Resolve / Dismiss / Reopen an HHAeXchange Sync Exception
module.exports.validateUpdateHhaSyncExceptionBody = ({data}) => {
  const bodySchema = Yup.object().shape({
    status: Yup.string()
      .required('Status is required')
      .oneOf(
        HHA_SYNC_EXCEPTION_ADMIN_STATUSES,
        `Status must be one of: ${HHA_SYNC_EXCEPTION_ADMIN_STATUSES.join(', ')}`
      ),
    note: Yup.string()
      .trim()
      .max(HHA_SYNC_HISTORY_MAX_LENGTHS.RESOLUTION_NOTE)
      .nullable(),
  });

  return validatorUtils.validate({schema: bodySchema, data});
};

// 🏘️ Add an Exception's Missing County to a Region
module.exports.validateAddHhaSyncExceptionCountyBody = ({data}) => {
  const bodySchema = Yup.object().shape({
    regionId: validatorUtils.uuidValidate({name: REGION_ENTITY_LABEL}),
  });

  return validatorUtils.validate({schema: bodySchema, data});
};

// 📧 List People Sharing an HHAeXchange Email
module.exports.validateListHhaEmailConflictsQuery = ({data}) => {
  const querySchema = commonPaginationSchema().shape({
    status: oneOfFilter({
      values: HHA_EMAIL_CONFLICT_FILTERS_VALUES,
      label: 'Status',
    }),
  });

  return validatorUtils.validate({schema: querySchema, data});
};

// 🆔 Validate the User of a Shared Email
module.exports.validateHhaEmailConflictUserParams = ({data}) => {
  const paramsSchema = Yup.object().shape({
    userId: validatorUtils.uuidValidate({name: USER_ENTITY_LABEL}),
  });

  return validatorUtils.validate({schema: paramsSchema, data});
};

// ✏️ Give a Shared-Email User a Unique Login Email
module.exports.validateUpdateHhaEmailConflictUserBody = ({data}) => {
  const bodySchema = Yup.object().shape({
    email: Yup.string()
      .trim()
      .lowercase()
      .email('Email must be a valid email address')
      .max(HHAX_FIELD_MAX_LENGTHS.EMAIL)
      .required('Email is required'),
  });

  return validatorUtils.validate({schema: bodySchema, data});
};

// 👥 List Patients With More Than One HHAeXchange Coordinator
module.exports.validateListHhaCoordinatorPatientsQuery = ({data}) => {
  const querySchema = commonPaginationSchema().shape({
    choice: oneOfFilter({
      values: HHA_COORDINATOR_CHOICE_FILTERS_VALUES,
      label: 'Choice',
    }),
  });

  return validatorUtils.validate({schema: querySchema, data});
};

// 🆔 Validate the Patient Whose Case Manager Is Chosen
module.exports.validateHhaPatientParams = ({data}) => {
  const paramsSchema = Yup.object().shape({
    patientId: validatorUtils.uuidValidate({name: PATIENT_ENTITY_LABEL}),
  });

  return validatorUtils.validate({schema: paramsSchema, data});
};

// ✅ Choose Between the PreventaTri and the HHAeXchange Primary Nurse
module.exports.validateSelectHhaPatientPrimaryNurseBody = ({data}) => {
  const bodySchema = Yup.object().shape({
    choice: Yup.string()
      .required('Choice is required')
      .oneOf(
        HHA_PRIMARY_NURSE_CHOICES_VALUES,
        `Choice must be one of: ${HHA_PRIMARY_NURSE_CHOICES_VALUES.join(', ')}`
      ),
  });

  return validatorUtils.validate({schema: bodySchema, data});
};

// ✅ Choose a Patient's Case Manager From Its HHAeXchange Coordinators
module.exports.validateSelectHhaPatientCaseManagerBody = ({data}) => {
  const bodySchema = Yup.object().shape({
    caseManagerProfileId: validatorUtils.uuidValidate({
      name: CASE_MANAGER_ENTITY_LABEL,
    }),
  });

  return validatorUtils.validate({schema: bodySchema, data});
};
