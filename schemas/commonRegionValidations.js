/**
 * Common Yup validation schemas for regions
 * Reusable validation patterns to avoid repetition across different validation functions
 */

const Yup = require('yup');

const {modelConstants} = require('../constants');
const {validatorUtils} = require('../utils');
const commonCountyValidations = require('./commonCountyValidations');

/**
 * Region Name validation
 * Used in: validateCreateRegionRequest, validateUpdateRegionRequest
 */
module.exports.regionNameSchema = ({required = false} = {}) => {
  let schema = Yup.string()
    .trim()
    .min(2, 'Region name must be at least 2 characters')
    .max(100, 'Region name must not exceed 100 characters');

  return required ? schema.required('Region name is required') : schema;
};

/**
 * Region Code validation
 * Format: Uppercase letters, numbers, underscores only
 * Examples: "PA_NORTH", "REGION_01", "NY_EAST"
 * Used in: validateCreateRegionRequest, validateUpdateRegionRequest
 */
module.exports.regionCodeSchema = ({required = false} = {}) => {
  let schema = Yup.string()
    .trim()
    .min(2, 'Region code must be at least 2 characters')
    .max(50, 'Region code must not exceed 50 characters')
    .matches(
      /^[A-Z0-9_]+$/,
      'Region code must be uppercase letters, numbers, and underscores only'
    );

  return required ? schema.required('Region code is required') : schema;
};

/**
 * Region Active Status validation
 * Used in: validateCreateRegionRequest, validateUpdateRegionRequest
 */
module.exports.regionIsActiveSchema = ({withDefault = false} = {}) => {
  let schema = Yup.boolean();

  return withDefault ? schema.default(true) : schema;
};

/**
 * Region ID (UUID) validation for params
 * Uses modelConstants.MODELS.REGION for consistent model name reference
 * Used in: validateRegionIdParams
 */
module.exports.regionIdSchema = () => {
  return validatorUtils.uuidValidate({name: modelConstants.MODELS.REGION});
};

/**
 * Region Primary Nurse Profile ID validation
 * Optional UUID — references an existing NurseProfile. Server-side checks
 * that the profile is ACTIVE, not soft-deleted, has an isVerified user,
 * and belongs to the same organization.
 * Used in: validateCreateRegionRequest, validateUpdateRegionRequest
 */
module.exports.regionPrimaryNurseIdSchema = () => {
  return Yup.string()
    .uuid('primaryNurseProfileId must be a valid UUID')
    .nullable();
};

/**
 * Region Secondary Nurse Profile ID validation
 * Same rules as primaryNurseProfileId. Cross-field validation (must differ
 * from primary) is enforced at the request-schema level via .test().
 * Used in: validateCreateRegionRequest, validateUpdateRegionRequest
 */
module.exports.regionSecondaryNurseIdSchema = () => {
  return Yup.string()
    .uuid('secondaryNurseProfileId must be a valid UUID')
    .nullable();
};

/**
 * Region Nurse Profile IDs validation (UUID array)
 * A region may have multiple primary and multiple secondary nurses. Each list is
 * optional — an omitted list (undefined) leaves that role untouched on update,
 * and an empty array clears it. Server-side checks that every profile is ACTIVE,
 * not soft-deleted, has an isVerified user, and belongs to the same organization;
 * cross-list uniqueness (a nurse can't be both) is enforced via .test() at the
 * request-schema level and by the DB unique(nurseProfileId, regionId) constraint.
 * Used in: validateCreateRegionRequest, validateUpdateRegionRequest
 */
module.exports.regionNurseIdsSchema = () => {
  return Yup.array().of(
    validatorUtils.uuidValidate({name: modelConstants.MODELS.NURSE_PROFILE})
  );
};

/**
 * Counties array validation for region create/update
 * Each entry is {fipsCode} (a county picked from the US list) or, on update,
 * {id} (a county the region already has — the only way to keep one typed in
 * before FIPS codes existed).
 * Used in: validateCreateRegionRequest, validateUpdateRegionRequest
 */
module.exports.regionCountiesSchema = ({allowExisting = false} = {}) => {
  const shape = {fipsCode: commonCountyValidations.countyFipsCodeSchema()};

  if (allowExisting) {
    shape.id = commonCountyValidations.countyIdSchema({required: false});
  }

  return Yup.array()
    .of(
      Yup.object()
        .shape(shape)
        .test(
          'one-county-reference',
          allowExisting
            ? 'Each county needs either an id or a county code'
            : 'Each county needs a county code',
          (county) => Boolean(county?.id) !== Boolean(county?.fipsCode)
        )
    )
    .min(1, 'At least one county is required')
    .test('no-duplicate-counties', 'Counties must be unique', (counties) => {
      if (!counties || counties.length === 0) return true;
      const keys = counties.map((county) => county?.id || county?.fipsCode);

      return keys.length === new Set(keys).size;
    });
};
