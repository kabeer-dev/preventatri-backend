const Yup = require('yup');

const {validatorUtils} = require('../utils');
const commonCountyValidations = require('./commonCountyValidations');
const {searchSchema} = require('./commonEntityValidations');
const commonRegionValidations = require('./commonRegionValidations');
const {commonPaginationSchema} = require('./commonSchema');
const {COUNTIES_SORT_FIELDS_VALUES} = require('../constants/countiesConstants');
const {SORT_ORDERS_VALUES} = require('../constants/generalConstant');

// 📋 List Counties Query Params
module.exports.validateListCountiesQuery = ({data}) => {
  const paginationBase = commonPaginationSchema({
    sortFieldsValues: COUNTIES_SORT_FIELDS_VALUES,
    sortOrdersValues: SORT_ORDERS_VALUES,
  });

  const querySchema = paginationBase.shape({
    regionId: Yup.string().uuid('regionId must be a valid UUID'),
    regionIsActive: Yup.string().oneOf(
      ['true', 'false'],
      'regionIsActive must be true or false'
    ),
    search: searchSchema(),
  });

  return validatorUtils.validate({schema: querySchema, data});
};

// 📋 List Reference (US) Counties Query Params
module.exports.validateListReferenceCountiesQuery = ({data}) => {
  const querySchema = commonPaginationSchema().shape({
    search: searchSchema(),
    stateCode: commonCountyValidations.stateCodeSchema(),
  });

  return validatorUtils.validate({schema: querySchema, data});
};

// 🆔 Validate County ID Params
module.exports.validateCountyIdParams = ({data}) => {
  const idSchema = Yup.object().shape({
    id: commonCountyValidations.countyIdSchema(),
  });

  return validatorUtils.validate({schema: idSchema, data});
};

// 🆔 Validate Region ID Params (reuse region validation)
module.exports.validateRegionIdParams = ({data}) => {
  const idSchema = Yup.object().shape({
    regionId: commonRegionValidations.regionIdSchema(),
  });

  return validatorUtils.validate({schema: idSchema, data});
};
