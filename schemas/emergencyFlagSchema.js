const Yup = require('yup');

const {validatorUtils} = require('../utils');
const {csvArraySchema, searchSchema} = require('./commonEntityValidations');
const {commonPaginationSchema} = require('./commonSchema');

const {SORT_ORDERS_VALUES} = require('../constants/generalConstant');

const {
  RED_FLAG_REASONS_VALUES,
  RED_FLAG_SORT_FIELDS_VALUES,
  EMERGENCY_FLAG_FILTER_VALUES,
} = require('../constants/redFlagConstants');

const {
  SUBMISSION_FLAG_STATUS_VALUES,
} = require('../constants/submissionFlagConstants');

module.exports.validateEmergencyFlagRequest = ({data}) => {
  const schema = Yup.object().shape({
    reason: Yup.number()
      .integer('Reason must be an integer')
      .oneOf(RED_FLAG_REASONS_VALUES, 'Invalid emergency flag reason')
      .required('Reason is required'),

    description: Yup.string()
      .trim()
      .max(5000, 'Description must not exceed 5000 characters')
      .required('Description is required'),

    patientId: validatorUtils.uuidValidate({
      name: 'Patient',
      required: true,
    }),
  });

  return validatorUtils.validate({schema, data});
};

module.exports.validateIdParams = ({data}) => {
  const paramsSchema = Yup.object().shape({
    id: validatorUtils.uuidValidate({name: 'Emergency Flag'}),
  });

  return validatorUtils.validate({schema: paramsSchema, data});
};

module.exports.validateVoidEmergencyFlagBody = ({data}) => {
  const voidSchema = Yup.object().shape({
    voidReason: Yup.string()
      .trim()
      .min(1, 'Void reason is required')
      .max(1000)
      .required('Void reason is required'),
  });

  return validatorUtils.validate({schema: voidSchema, data});
};

module.exports.validateListQuery = ({data}) => {
  const paginationBase = commonPaginationSchema({
    sortFieldsValues: RED_FLAG_SORT_FIELDS_VALUES,
    sortOrdersValues: SORT_ORDERS_VALUES,
  });

  const listSchema = paginationBase.shape({
    patientId: Yup.string().uuid('Invalid Patient id'),
    submittedBy: Yup.string().uuid('Invalid User id'),
    flag: Yup.string().oneOf(
      EMERGENCY_FLAG_FILTER_VALUES,
      'Invalid flag colour'
    ),
    status: Yup.array()
      .transform((value, originalValue) => {
        if (originalValue === undefined || originalValue === null) return [];
        if (Array.isArray(originalValue)) return originalValue;

        return String(originalValue)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      })
      .of(Yup.string().oneOf(SUBMISSION_FLAG_STATUS_VALUES, 'Invalid status')),
    regionId: csvArraySchema({of: Yup.string().uuid('Invalid Region id')}),
    search: searchSchema(),
  });

  return validatorUtils.validate({schema: listSchema, data});
};
