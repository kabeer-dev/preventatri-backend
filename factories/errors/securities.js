const AppError = require('./app');

const {
  SECURITY_ERRORS_TYPES,
} = require('../../constants/responses/errors/securities');

module.exports = class SecuritiesErrorsFactories {
  static phoneNumberRequiredForPhoneOtpErr() {
    return new AppError({
      message:
        'You do not have a phone number on your account. Please add one in your settings before enabling phone OTP.',
      statusCode: 400,
      error: {type: SECURITY_ERRORS_TYPES.phoneNumberRequiredForPhoneOtp.value},
    });
  }
};
