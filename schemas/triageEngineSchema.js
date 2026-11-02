const Yup = require('yup');

const {csvArraySchema} = require('./commonEntityValidations');
const {commonPaginationSchema} = require('./commonSchema');
const {RISK_SCORE_THRESHOLDS} = require('../constants/riskCalcConstants');
const {validatorUtils} = require('../utils');

module.exports.validateGetStatsQuery = ({data}) => {
  // Optional date window for the GREEN flag count. When omitted, the controller
  // defaults to the last 30 days. endDate must not precede startDate.
  const schema = Yup.object().shape({
    startDate: Yup.date().typeError('startDate must be a valid date'),
    endDate: Yup.date()
      .typeError('endDate must be a valid date')

      // Only compare against startDate when it was actually supplied —
      // otherwise the min() check rejects endDate-only requests.
      .when('startDate', {
        is: (startDate) => Boolean(startDate),
        then: (schema) =>
          schema.min(
            Yup.ref('startDate'),
            'endDate cannot be before startDate'
          ),
      }),
  });

  return validatorUtils.validate({schema, data});
};

module.exports.validateGetAlertsQuery = ({data}) => {
  const schema = commonPaginationSchema().shape({
    flag: Yup.string().oneOf(
      Object.keys(RISK_SCORE_THRESHOLDS),
      'Invalid flag colour'
    ),
    regionId: csvArraySchema({of: Yup.string().uuid('Invalid Region id')}),
  });

  return validatorUtils.validate({schema, data});
};
