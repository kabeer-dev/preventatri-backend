/**
 * Common Yup validation schemas for nurses
 * Nurse-specific validations only – shared schemas live in commonEntityValidations.js
 */

const Yup = require('yup');

const {US_STATE_CODE_LENGTH} = require('../constants/countiesConstants');

const {
  NURSE_DEFAULT_LICENSE_STATE,
  PROFESSIONAL_ROLES_VALUES,
} = require('../constants/nursesConstants');
const {dateUtils} = require('../utils');
const {isUsStateCode} = require('../utils/usCountyUtils');

/**
 * Professional Role validation
 * Used in: validateNurseInviteRequest, validateNurseProfileUpdateRequest
 */
module.exports.professionalRoleSchema = ({required = false} = {}) => {
  let schema = Yup.string().oneOf(
    PROFESSIONAL_ROLES_VALUES,
    `Professional role must be one of: ${PROFESSIONAL_ROLES_VALUES.join(', ')}`
  );

  return required ? schema.required('Professional role is required') : schema;
};

/**
 * License Number validation
 * Used in: validateNurseInviteRequest, validateNurseProfileUpdateRequest
 */
module.exports.licenseNumberSchema = ({required = false} = {}) => {
  let schema = Yup.string().max(
    50,
    'License number must not exceed 50 characters'
  );

  return required ? schema.required('License number is required') : schema;
};

/**
 * License State validation
 * Used in: validateNurseInviteRequest, validateNurseProfileUpdateRequest
 */
module.exports.licenseStateSchema = ({
  required = false,
  withDefault = false,
} = {}) => {
  let schema = Yup.string()
    .length(
      US_STATE_CODE_LENGTH,
      `License state must be exactly ${US_STATE_CODE_LENGTH} characters`
    )
    .uppercase('License state must be uppercase')
    .test(
      'known-state',
      'License state is not a US state or territory',
      (stateCode) => !stateCode || isUsStateCode({stateCode})
    );

  if (withDefault) {
    schema = schema.default(NURSE_DEFAULT_LICENSE_STATE);
  }

  return required ? schema.required('License state is required') : schema;
};

/**
 * License Expiration Date validation
 * Uses dateUtils.getCurrentDateTime() for consistent date handling
 * Used in: validateNurseInviteRequest, validateNurseProfileUpdateRequest
 */
module.exports.licenseExpirationDateSchema = ({
  required = false,
  mustBeFuture = false,
} = {}) => {
  let schema = Yup.date();

  if (mustBeFuture) {
    schema = schema.min(
      new Date(dateUtils.getCurrentDateTime()),
      'License expiration date must be in the future'
    );
  }

  return required
    ? schema.required('License expiration date is required')
    : schema;
};

/**
 * NPI (National Provider Identifier) validation
 * Used in: validateNurseInviteRequest, validateNurseProfileUpdateRequest
 */
module.exports.npiSchema = ({nullable = false} = {}) => {
  let schema = Yup.string()
    .matches(/^\d{10}$/, 'NPI must be exactly 10 digits')
    .transform((value, originalValue) =>
      originalValue === '' || originalValue === null
        ? null
        : String(originalValue)
    );

  return nullable ? schema.nullable() : schema;
};
