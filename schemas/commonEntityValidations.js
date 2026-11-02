/**
 * Common Yup validation schemas shared across multiple entity types
 * (nurse, caregiver, patient, case manager)
 *
 * Centralizes schemas that were previously duplicated in per-entity common files.
 */

const Yup = require('yup');

const {
  ENTITY_STATUSES_VALUES,
  ENTITY_STATUSES,
} = require('../constants/generalConstant');

const {validatorUtils, dateUtils, safeConcat} = require('../utils');

// ==========================================
/**
 * Entity Status validation (ACTIVE / INACTIVE / all)
 * Used for query params where 'all' is a valid option
 */
module.exports.entityStatusWithAllSchema = ({required = false} = {}) => {
  const valuesWithAll = safeConcat({
    originalArray: ENTITY_STATUSES_VALUES,
    newArray: ['all'],
  });

  let schema = Yup.string().oneOf(
    valuesWithAll,
    `Status must be one of: ${valuesWithAll.join(', ')}`
  );

  return required ? schema.required('Status is required') : schema;
};

// SHARED SCHEMAS
// ==========================================

/**
 * Entity Status validation (ACTIVE / INACTIVE)
 * Used by: nurse, caregiver, case manager
 * NOTE: Patient has its own status set (PATIENT_STATUSES) – do NOT use this for patients.
 */
module.exports.entityStatusSchema = ({
  required = false,
  withDefault = false,
} = {}) => {
  let schema = Yup.string().oneOf(
    ENTITY_STATUSES_VALUES,
    `Status must be one of: ${ENTITY_STATUSES_VALUES.join(', ')}`
  );

  if (withDefault) {
    schema = schema.default(ENTITY_STATUSES.ACTIVE.value);
  }

  return required ? schema.required('Status is required') : schema;
};

/**
 * Notes validation (max 2000 chars)
 * Used by: nurse, caregiver, patient
 */
module.exports.notesSchema = ({nullable = false} = {}) => {
  let schema = Yup.string().max(2000, 'Notes must not exceed 2000 characters');

  return nullable ? schema.nullable() : schema;
};

/**
 * Region IDs validation (UUID array)
 * Used by: nurse, case manager
 */
module.exports.regionIdsSchema = ({
  required = false,
  fieldLabel = 'region',
} = {}) => {
  const normalizedFieldLabel = fieldLabel.toLowerCase();
  const requiredMessage = `At least one ${normalizedFieldLabel} is required`;

  let schema = Yup.array()
    .of(validatorUtils.uuidValidate({name: 'Region'}))
    .min(1, requiredMessage);

  return required ? schema.required(requiredMessage) : schema;
};

/**
 * Date of Birth validation
 * Used by: patient (create / update)
 */
module.exports.dateOfBirthSchema = ({required = false} = {}) => {
  let schema = Yup.date().max(
    dateUtils.currentDate(),
    'Date of birth cannot be in the future'
  );

  return required ? schema.required('Date of birth is required') : schema;
};

module.exports.searchSchema = () =>
  Yup.string().trim().max(200, 'Search must not exceed 200 characters');

// A multi-value query param arrives as a repeated key or one comma list.
module.exports.csvArraySchema = ({of}) =>
  Yup.array()
    .transform((value, originalValue) => {
      if (originalValue === undefined || originalValue === null) {
        return undefined;
      }
      if (Array.isArray(originalValue)) return originalValue;

      return String(originalValue)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    })
    .of(of);

/**
 * A required free-text reason (cancellation, correction request).
 */
module.exports.reasonSchema = ({fieldName = 'Reason', max, requiredMessage}) =>
  Yup.string()
    .trim()
    .min(1, requiredMessage)
    .max(max, `${fieldName} must not exceed ${max} characters`)
    .required(requiredMessage);

/**
 * Checklist answers submitted with a work item (follow-up task, supervisory
 * visit): one entry per question, each at most once.
 */
module.exports.checklistAnswerSchema = () =>
  Yup.object().shape({
    questionId: validatorUtils.uuidValidate({name: 'Question'}),
    value: Yup.mixed().nullable(),
    comment: Yup.string().trim().max(2000).nullable(),
  });

module.exports.checklistAnswersSchema = () =>
  Yup.array()
    .of(module.exports.checklistAnswerSchema())
    .nullable()
    .test(
      'unique-question-ids',
      'Each question can only be answered once',
      (answers) => {
        if (!answers) return true;
        const questionIds = answers.map((a) => a.questionId);

        return new Set(questionIds).size === questionIds.length;
      }
    );

/**
 * Common list query filter fields shared across entity list endpoints.
 *
 * Returns a plain shape object ready to pass into paginationBase.shape() or
 * combine via safeMerge with entity-specific filters.
 *
 * @param {object} options
 * @param {boolean} [options.withStatus=true]       Include status filter (entityStatusWithAllSchema by default)
 * @param {object}  [options.statusSchema=null]     Override the default status schema (e.g. for patient-specific statuses)
 * @param {boolean} [options.withSearch=true]       Include search filter
 * @param {boolean} [options.withRegionId=false]    Include regionId UUID filter
 * @param {object}  [options.roleSchema=null]       Include role filter with the supplied schema
 */
module.exports.commonListFiltersSchema = ({
  withStatus = true,
  statusSchema = null,
  withSearch = true,
  withRegionId = false,
  withIsVerified = false,
  roleSchema = null,
} = {}) => {
  const shape = {};

  if (withStatus) {
    shape.status = statusSchema || module.exports.entityStatusWithAllSchema();
  }
  if (withSearch) {
    shape.search = module.exports.searchSchema();
  }
  if (withRegionId) {
    shape.regionId = validatorUtils.uuidValidate({
      name: 'Region',
      required: false,
    });
  }
  if (withIsVerified) {
    shape.isVerified = Yup.string().oneOf(
      ['true', 'false'],
      'isVerified must be true or false'
    );
  }
  if (roleSchema) {
    shape.role = roleSchema;
  }

  return shape;
};
