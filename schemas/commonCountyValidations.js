/**
 * Common Yup validation schemas for counties
 * Reusable validation patterns to avoid repetition across different validation functions
 */

const Yup = require('yup');

const {modelConstants} = require('../constants');
const {US_STATE_CODE_LENGTH} = require('../constants/countiesConstants');
const {COUNTY_FIPS_LENGTH} = require('../constants/usZipCountyConstants');
const {validatorUtils} = require('../utils');
const {getReferenceCounty} = require('../utils/usCountyUtils');

/**
 * County FIPS code validation: must be a county in the US reference data.
 * Used in: region create/update
 */
module.exports.countyFipsCodeSchema = () =>
  Yup.string()
    .trim()
    .length(
      COUNTY_FIPS_LENGTH,
      `County code must be ${COUNTY_FIPS_LENGTH} digits`
    )
    .test(
      'known-county',
      'County code is not a known US county',
      (fipsCode) => !fipsCode || Boolean(getReferenceCounty({fipsCode}))
    );

/**
 * Two-letter state filter for the reference county list
 */
module.exports.stateCodeSchema = () =>
  Yup.string()
    .trim()
    .length(
      US_STATE_CODE_LENGTH,
      `State code must be ${US_STATE_CODE_LENGTH} letters`
    );

/**
 * County Active Status validation
 * Used in: validateCreateCountyRequest, validateUpdateCountyRequest
 */
module.exports.countyIsActiveSchema = ({withDefault = false} = {}) => {
  let schema = Yup.boolean();

  return withDefault ? schema.default(true) : schema;
};

/**
 * County ID (UUID) validation
 * Single source of truth — used by county params, patient create/update, etc.
 * Uses modelConstants.MODELS.COUNTY for consistent model name reference
 */
module.exports.countyIdSchema = ({required = true} = {}) => {
  return validatorUtils.uuidValidate({
    name: modelConstants.MODELS.COUNTY,
    required,
  });
};
