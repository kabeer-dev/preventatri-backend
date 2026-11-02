const Yup = require('yup');

const {
  ORGANIZATION_STATUSES_VALUES,
  ORGANIZATION_REASON_MAX_LENGTH,
} = require('../constants/organizationsConstants');
const {validatorUtils} = require('../utils');

const {commonPaginationSchema} = require('./commonSchema');

// 📋 List organizations
module.exports.validateListOrganizationsQuery = ({data}) => {
  const querySchema = commonPaginationSchema().shape({
    status: Yup.string().oneOf(
      ORGANIZATION_STATUSES_VALUES,
      `status must be one of: ${ORGANIZATION_STATUSES_VALUES.join(', ')}`
    ),
    search: Yup.string().trim().max(120),
  });

  return validatorUtils.validate({schema: querySchema, data});
};

// 🆔 Organization id in the path
module.exports.validateOrganizationIdParams = ({data}) => {
  const idSchema = Yup.object().shape({
    id: validatorUtils.uuidValidate({name: 'Organization'}),
  });

  return validatorUtils.validate({schema: idSchema, data});
};

// 📝 Optional reason sent with a rejection or a suspension
module.exports.validateOrganizationDecisionBody = ({data}) => {
  const bodySchema = Yup.object().shape({
    reason: Yup.string()
      .trim()
      .max(
        ORGANIZATION_REASON_MAX_LENGTH,
        `reason must be at most ${ORGANIZATION_REASON_MAX_LENGTH} characters`
      ),
  });

  return validatorUtils.validate({schema: bodySchema, data});
};
