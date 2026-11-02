const Yup = require('yup');

const {searchSchema} = require('./commonEntityValidations');

const {GLOBAL_SEARCH_LIMITS} = require('../constants/globalSearchConstants');
const {validatorUtils} = require('../utils');

/**
 * Validate the query for GET /search.
 * `search` is required; `limit` caps each result group (patients, staff).
 */
module.exports.validateGlobalSearchQuery = ({data}) => {
  const schema = Yup.object().shape({
    search: searchSchema()
      .min(
        GLOBAL_SEARCH_LIMITS.minChars,
        `Search must be at least ${GLOBAL_SEARCH_LIMITS.minChars} characters`
      )
      .required('Search is required'),
    limit: Yup.number()
      .typeError('Limit must be a number')
      .positive('Limit must be positive')
      .integer('Limit must be an integer')
      .max(
        GLOBAL_SEARCH_LIMITS.maxLimit,
        `Limit must not exceed ${GLOBAL_SEARCH_LIMITS.maxLimit}`
      )
      .default(GLOBAL_SEARCH_LIMITS.defaultLimit),
  });

  return validatorUtils.validate({schema, data});
};
