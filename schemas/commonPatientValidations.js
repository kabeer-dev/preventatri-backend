/**
 * Common Yup validation schemas for patients
 * Patient-specific validations only – shared schemas live in commonEntityValidations.js
 */

const Yup = require('yup');

const commonCountyValidations = require('./commonCountyValidations');
const {SYSTEM_ENTITIES} = require('../constants/aclConstants');

const {
  PATIENT_STATUSES_VALUES,
  RISK_LEVELS_VALUES,
  PATIENT_STATUSES,
  GENDERS_VALUES,
} = require('../constants/patientsConstants');
const {validatorUtils} = require('../utils');

/**
 * Patient Status validation
 */
module.exports.patientStatusSchema = ({
  required = false,
  withDefault = false,
} = {}) => {
  let schema = Yup.string().oneOf(
    PATIENT_STATUSES_VALUES,
    `Status must be one of: ${PATIENT_STATUSES_VALUES.join(', ')}`
  );

  if (withDefault) {
    schema = schema.default(PATIENT_STATUSES.ACTIVE.value);
  }

  return required ? schema.required('Status is required') : schema;
};

/**
 * Risk Level validation
 */
module.exports.riskLevelSchema = ({
  required = false,
  nullable = false,
} = {}) => {
  let schema = Yup.string().oneOf(
    RISK_LEVELS_VALUES,
    `Risk level must be one of: ${RISK_LEVELS_VALUES.join(', ')}`
  );

  if (nullable) {
    schema = schema.nullable();
  }

  return required ? schema.required('Risk level is required') : schema;
};

/**
 * Gender validation
 */
module.exports.genderSchema = ({required = false} = {}) => {
  let schema = Yup.string().oneOf(
    GENDERS_VALUES,
    `Gender must be one of: ${GENDERS_VALUES.join(', ')}`
  );

  return required ? schema.required('Gender is required') : schema;
};

/**
 * County ID validation — re-exported from commonCountyValidations (single source of truth)
 */
module.exports.countyIdSchema = ({required = false} = {}) => {
  return commonCountyValidations.countyIdSchema({required});
};

/**
 * Medicaid ID validation
 */
module.exports.medicaidIdSchema = ({nullable = false} = {}) => {
  let schema = Yup.string().max(
    50,
    'Medicaid ID must not exceed 50 characters'
  );

  return nullable ? schema.nullable() : schema;
};

/**
 * Address validation
 */
module.exports.addressSchema = ({nullable = false} = {}) => {
  let schema = Yup.string().max(255, 'Address must not exceed 255 characters');

  return nullable ? schema.nullable() : schema;
};

/**
 * Zip Code validation
 */
module.exports.zipCodeSchema = ({nullable = false} = {}) => {
  let schema = Yup.string().matches(
    /^\d{5}(-\d{4})?$/,
    'Zip code must be in format 12345 or 12345-6789'
  );

  return nullable ? schema.nullable() : schema;
};

/**
 * Optional NurseProfile id assigned to a patient (primary or secondary).
 * Nullable so the client can explicitly clear the assignment.
 */
module.exports.patientNurseProfileIdSchema = ({fieldLabel = 'Nurse'} = {}) =>
  validatorUtils.uuidValidate({name: fieldLabel, required: false}).nullable();

/**
 * Caregiver Profile IDs validation (array)
 */
module.exports.caregiverProfileIdsSchema = ({required = false} = {}) => {
  let schema = Yup.array()
    .of(
      validatorUtils.uuidValidate({
        name: SYSTEM_ENTITIES.caregiver.label,
      })
    )
    .min(1, 'At least one caregiver must be assigned');

  return required
    ? schema.required('Caregiver assignment is required')
    : schema;
};
