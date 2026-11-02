const Yup = require('yup');

const {
  AUDIT_OPERATIONS_VALUES,
  AUDIT_LOGS_MAX_RANGE_DAYS,
  AUDIT_EXPORT_TYPE_VALUES,
  AUDIT_EXPORT_FORMAT_VALUES,
  AUDIT_EXPORT_TITLE_MAX_LENGTH,
  AUDIT_EXPORT_FILTERS_MAX_BYTES,
} = require('../constants/auditConstants');

const {
  AUDIT_RESOURCE_TYPE_VALUES,
} = require('../constants/requestLoggerConstants');
const {validatorUtils, dateUtils} = require('../utils');

/**
 * Validate the query for GET /audit-logs.
 * Every filter is optional and independently combinable -- resourceType,
 * resourceId, action, and userId can each be passed alone or together, and
 * omitting all of them lists every log in the org (still bounded by
 * fromDate/toDate). `fromDate`/`toDate` default to the trailing
 * AUDIT_LOGS_DEFAULT_RANGE_DAYS days when omitted, and the resulting window
 * (defaulted or explicit) can't exceed AUDIT_LOGS_MAX_RANGE_DAYS.
 */
module.exports.validateListAuditLogsQuery = ({data}) => {
  const schema = Yup.object()
    .shape({
      resourceType: Yup.string().oneOf(
        AUDIT_RESOURCE_TYPE_VALUES,
        `resourceType must be one of: ${AUDIT_RESOURCE_TYPE_VALUES.join(', ')}`
      ),
      resourceId: validatorUtils.uuidValidate({
        name: 'resource',
        required: false,
      }),
      action: Yup.string().oneOf(
        AUDIT_OPERATIONS_VALUES,
        `action must be one of: ${AUDIT_OPERATIONS_VALUES.join(', ')}`
      ),
      userId: validatorUtils.uuidValidate({name: 'user', required: false}),
      page: Yup.number()
        .typeError('page must be a number')
        .positive()
        .integer()
        .default(1),
      limit: Yup.number()
        .typeError('limit must be a number')
        .positive()
        .integer()
        .max(100)
        .default(10),
      fromDate: Yup.date().typeError('fromDate must be a valid date'),
      toDate: Yup.date()
        .typeError('toDate must be a valid date')
        .min(Yup.ref('fromDate'), 'toDate cannot be before fromDate'),
    })
    .test(
      'within-max-range',
      `Date range cannot exceed ${AUDIT_LOGS_MAX_RANGE_DAYS} days`,
      ({fromDate, toDate}) => {
        if (!fromDate || !toDate) return true;

        const spanDays = dateUtils
          .toLuxonUTC({date: toDate})
          .diff(dateUtils.toLuxonUTC({date: fromDate}), 'days').days;

        return spanDays <= AUDIT_LOGS_MAX_RANGE_DAYS;
      }
    );

  return validatorUtils.validate({schema, data});
};

/**
 * Validate the body for POST /audit-logs/exports.
 * `filters` is free-form (it describes whatever the export screen filtered
 * on), so it is only checked for being a plain object under a size cap.
 */
module.exports.validateLogExportBody = ({data}) => {
  const schema = Yup.object().shape({
    exportType: Yup.string()
      .oneOf(
        AUDIT_EXPORT_TYPE_VALUES,
        `exportType must be one of: ${AUDIT_EXPORT_TYPE_VALUES.join(', ')}`
      )
      .required('exportType is required'),
    format: Yup.string()
      .oneOf(
        AUDIT_EXPORT_FORMAT_VALUES,
        `format must be one of: ${AUDIT_EXPORT_FORMAT_VALUES.join(', ')}`
      )
      .required('format is required'),
    title: Yup.string()
      .trim()
      .max(
        AUDIT_EXPORT_TITLE_MAX_LENGTH,
        `title cannot exceed ${AUDIT_EXPORT_TITLE_MAX_LENGTH} characters`
      ),
    filters: Yup.mixed()
      .test(
        'is-plain-object',
        'filters must be an object',
        (value) =>
          value === undefined ||
          (value !== null && typeof value === 'object' && !Array.isArray(value))
      )
      .test(
        'within-size',
        `filters cannot exceed ${AUDIT_EXPORT_FILTERS_MAX_BYTES} bytes`,
        (value) =>
          value === undefined ||
          Buffer.byteLength(JSON.stringify(value)) <=
            AUDIT_EXPORT_FILTERS_MAX_BYTES
      ),
    recordCount: Yup.number()
      .typeError('recordCount must be a number')
      .integer()
      .min(0),
  });

  return validatorUtils.validate({schema, data});
};
