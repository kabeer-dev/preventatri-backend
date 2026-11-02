/**
 * Common Yup validation schemas for caregivers
 * Caregiver-specific validations only – shared schemas live in commonEntityValidations.js
 */

const Yup = require('yup');

const {SYSTEM_ENTITIES} = require('../constants/aclConstants');

const {
  CAREGIVER_STATUSES,
  CAREGIVER_STATUSES_VALUES,
} = require('../constants/caregiversConstants');

const {HHAX_FIELD_MAX_LENGTHS} = require('../constants/hhaExchangeConstants');

const {validatorUtils} = require('../utils');

/**
 * Caregiver status validation.
 *
 * Caregiver-specific rather than the shared entityStatusSchema: CaregiverStatus
 * has six members (the two PreventaTri always had plus HOLD, ON_LEAVE,
 * TERMINATED and REJECTED, which HHAeXchange sets), while nurses and case
 * managers still have two. Validating caregivers against the shared two-value
 * set would reject a status the sync writes and the UI shows.
 */
module.exports.caregiverStatusSchema = ({
  withDefault = false,
  withAll = false,
} = {}) => {
  const allowedValues = withAll
    ? [].concat(CAREGIVER_STATUSES_VALUES, ['all'])
    : CAREGIVER_STATUSES_VALUES;

  let schema = Yup.string().oneOf(
    allowedValues,
    `Status must be one of: ${allowedValues.join(', ')}`
  );

  return withDefault ? schema.default(CAREGIVER_STATUSES.ACTIVE.value) : schema;
};

/**
 * Role validation
 * Used in: validateCaregiverInviteRequest, validateCaregiverProfileUpdateRequest
 */
module.exports.roleSchema = ({required = false} = {}) => {
  let schema = Yup.string().max(50, 'Role must not exceed 50 characters');

  return required ? schema.required('Role is required') : schema;
};

/**
 * Relationship to Patient validation
 */
module.exports.relationshipToPatientSchema = ({
  required = false,
  nullable = false,
} = {}) => {
  let schema = Yup.string().max(
    100,
    'Relationship must not exceed 100 characters'
  );

  if (nullable) {
    schema = schema.nullable();
  }

  return required
    ? schema.required('Relationship to patient is required')
    : schema;
};

/**
 * Language validation.
 *
 * The bound is the COLUMN width, not a round number: language is
 * VarChar(10) and holds a code ('en', 'es', 'ht'), not a display name. The
 * previous max(50) accepted 'Haitian Creole' through Yup and then failed the
 * insert with a Postgres 22001, on a field the caller could do nothing about.
 */
module.exports.languageSchema = ({nullable = false} = {}) => {
  let schema = Yup.string().max(
    HHAX_FIELD_MAX_LENGTHS.LANGUAGE,
    `Language must not exceed ${HHAX_FIELD_MAX_LENGTHS.LANGUAGE} characters`
  );

  return nullable ? schema.nullable() : schema;
};

/**
 * Patient IDs validation (array)
 */
module.exports.patientIdsSchema = ({required = false} = {}) => {
  let schema = Yup.array()
    .of(validatorUtils.uuidValidate({name: SYSTEM_ENTITIES.patient.label}))
    .min(1, 'At least one patient must be assigned');

  return required ? schema.required('Patient assignment is required') : schema;
};
