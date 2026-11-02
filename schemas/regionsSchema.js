const Yup = require('yup');

const {validatorUtils} = require('../utils');
const {searchSchema} = require('./commonEntityValidations');
const commonRegionValidations = require('./commonRegionValidations');
const {commonPaginationSchema} = require('./commonSchema');
const {SORT_ORDERS_VALUES} = require('../constants/generalConstant');

const {
  REGIONS_SORT_FIELDS_VALUES,
  REGION_ARCHIVE_FILTERS,
  REGION_ARCHIVE_FILTERS_VALUES,
} = require('../constants/regionsConstants');

// Cross-field rule shared by create + update: the same nurse cannot appear in
// both the primary and secondary nurse lists for a region (a nurse holds one
// role per region). Mirrors the nurse-side uniqueRegionIdsTest.
const nursesMustDifferTest = {
  name: 'region-nurse-roles-must-differ',
  message:
    'A nurse cannot be both a primary and a secondary nurse for the same region',
  test: (value) => {
    const primary = value && value.primaryNurseProfileIds;
    const secondary = value && value.secondaryNurseProfileIds;
    if (!primary || !secondary) return true;

    const primarySet = new Set(primary);

    return !secondary.some((nurseProfileId) => primarySet.has(nurseProfileId));
  },
};

// 📋 Create Region
module.exports.validateCreateRegionRequest = ({data}) => {
  const createSchema = Yup.object()
    .shape({
      name: commonRegionValidations.regionNameSchema({required: true}),

      // Code is optional — auto-generated from name if not provided
      code: commonRegionValidations.regionCodeSchema({required: false}),
      isActive: commonRegionValidations.regionIsActiveSchema({
        withDefault: true,
      }),

      // Counties are created alongside the region
      counties: commonRegionValidations.regionCountiesSchema(),

      // Optional primary/secondary nurses for the region (multiple allowed)
      primaryNurseProfileIds: commonRegionValidations.regionNurseIdsSchema(),
      secondaryNurseProfileIds: commonRegionValidations.regionNurseIdsSchema(),
    })
    .test(nursesMustDifferTest);

  return validatorUtils.validate({schema: createSchema, data});
};

// 🔄 Update Region
module.exports.validateUpdateRegionRequest = ({data}) => {
  const updateSchema = Yup.object()
    .shape({
      name: commonRegionValidations.regionNameSchema(),
      code: commonRegionValidations.regionCodeSchema(),
      isActive: commonRegionValidations.regionIsActiveSchema(),
      counties: commonRegionValidations.regionCountiesSchema({
        allowExisting: true,
      }),
      primaryNurseProfileIds: commonRegionValidations.regionNurseIdsSchema(),
      secondaryNurseProfileIds: commonRegionValidations.regionNurseIdsSchema(),
    })
    .test(
      'at-least-one-field',
      'At least one field must be provided for update',
      (value) => Object.keys(value).some((key) => value[key] !== undefined)
    )
    .test(nursesMustDifferTest);

  return validatorUtils.validate({schema: updateSchema, data});
};

// 🆔 Validate Region ID Params
module.exports.validateRegionIdParams = ({data}) => {
  const idSchema = Yup.object().shape({
    id: commonRegionValidations.regionIdSchema(),
  });

  return validatorUtils.validate({schema: idSchema, data});
};

// 📋 List Regions Query Params
module.exports.validateListRegionsQuery = ({data}) => {
  const paginationBase = commonPaginationSchema({
    sortFieldsValues: REGIONS_SORT_FIELDS_VALUES,
    sortOrdersValues: SORT_ORDERS_VALUES,
  });

  const querySchema = paginationBase.shape({
    isActive: Yup.string().oneOf(
      ['true', 'false'],
      'isActive must be true or false'
    ),
    search: searchSchema(),

    // active (default) hides archived regions, all returns both, archived
    // returns only archived.
    archiveFilter: Yup.string()
      .oneOf(
        REGION_ARCHIVE_FILTERS_VALUES,
        `archiveFilter must be one of: ${REGION_ARCHIVE_FILTERS_VALUES.join(', ')}`
      )
      .default(REGION_ARCHIVE_FILTERS.ACTIVE.value),
  });

  return validatorUtils.validate({schema: querySchema, data});
};
