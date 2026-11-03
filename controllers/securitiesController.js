const {
  SecurityResponsesFactories,
  SecuritiesErrorsFactories,
  UsersErrorsFactories,
} = require('../factories');
const {SecurityServices, UsersServices} = require('../services');
const {withOrganizationDetails} = require('../utils/userUtils');

module.exports = class SecuritiesController {
  static async getOtpMethods(req, res, next) {
    const userId = req.extra.jwtToken.user.id;

    const otpMethods = await SecurityServices.getOtpMethodsForUser({userId});

    return SecurityResponsesFactories.otpMethodsRetrieved({otpMethods});
  }

  static async updateOtpMethods(req, res, next) {
    const userId = req.extra.jwtToken.user.id;
    const {otpMethods} = req.body;

    // Email is mandatory at signup but phoneNo is optional, so phone OTP can
    // only be enabled once the user has a phone number. The login OTP is an
    // account-level message, so the number is the primary organization's.
    if (otpMethods.phone) {
      const {user} = await UsersServices.getUserById({id: userId});

      if (!user) throw UsersErrorsFactories.userNotFoundErr();

      const {phoneNo} = await withOrganizationDetails({user});

      if (!phoneNo?.trim())
        throw SecuritiesErrorsFactories.phoneNumberRequiredForPhoneOtpErr();
    }

    const {success, doc, error} =
      await SecurityServices.updateOtpMethodsForUser({userId, otpMethods});

    if (!success) throw error;

    return SecurityResponsesFactories.otpMethodsUpdated({
      otpMethods: doc.otpMethods,
    });
  }
};
