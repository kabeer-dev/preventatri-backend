const AppResponse = require('./app');

const {
  SECURITY_SUCCESS_TYPES,
} = require('../../constants/responses/success/securities');

module.exports = class SecurityResponsesFactories {
  static otpMethodsRetrieved({otpMethods}) {
    return new AppResponse({
      message: 'OTP methods retrieved successfully',
      statusCode: 200,
      body: {
        otpMethods,
        type: SECURITY_SUCCESS_TYPES.otpMethodsRetrieved.value,
      },
    });
  }

  static otpMethodsUpdated({otpMethods}) {
    return new AppResponse({
      message: 'OTP methods updated successfully',
      statusCode: 200,
      body: {
        otpMethods,
        type: SECURITY_SUCCESS_TYPES.otpMethodsUpdated.value,
      },
    });
  }
};
