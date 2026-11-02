const {modelConstants} = require('../constants');
const {DEFAULT_OTP_METHODS} = require('../constants/generalConstant');
const {PrismaFactory} = require('../factories');
const {safeMerge} = require('../utils/general');

module.exports = class SecurityServices {
  static async createSecuritySettings({userId, tx}) {
    return await PrismaFactory.create({
      model: modelConstants.MODELS.SECURITY,
      data: {userId, otpMethods: DEFAULT_OTP_METHODS},
      tx,
    });
  }

  static async getOtpMethodsForUser({userId}) {
    const {success, doc} = await PrismaFactory.findOne({
      model: modelConstants.MODELS.SECURITY,
      query: {userId},
    });

    return success && doc?.otpMethods
      ? safeMerge({originalObj: doc.otpMethods, newObj: {id: doc.id}})
      : DEFAULT_OTP_METHODS;
  }

  static async updateOtpMethodsForUser({userId, otpMethods}) {
    const {success, error, responseObj} = await PrismaFactory.updateOne({
      model: modelConstants.MODELS.SECURITY,
      query: {userId},
      data: {otpMethods},
    });

    if (success) return {success, doc: responseObj, error};

    // Every user gets a Security row on signup (and the backfill migration
    // covered users created before this table existed), but fall back to
    // creating one here with the requested otpMethods rather than erroring,
    // in case either was missed.
    const {
      success: createSuccess,
      doc: createdDoc,
      error: createError,
    } = await PrismaFactory.create({
      model: modelConstants.MODELS.SECURITY,
      data: {userId, otpMethods},
    });

    return createSuccess
      ? {success: true, doc: createdDoc, error: null}
      : {success: false, doc: null, error: createError || error};
  }
};
