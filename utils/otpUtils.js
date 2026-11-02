const config = require('config');

const {hashString, compareHashedString} = require('./bcryptUtils');
const {getCurrentTimeInSeconds} = require('./dateUtils');
const {generateRandomString, safeMerge} = require('./general');
const {generateToken, verifyToken} = require('./jwtUtils');
const {asyncTryCatch} = require('./tryCatchUtils');
const generalConstant = require('../constants/generalConstant');
const {secretKeyLength} = require('../constants/generalConstant');

module.exports.generateOtpJwtToken = ({
  payload,
  isRegenerateAllowTimeNeeded,
  isRandomSecretKeyNeeded = false,
  tokenSecret = null,
}) => {
  const preparedPayload = safeMerge({
    originalObj: payload,
    newObj: isRegenerateAllowTimeNeeded
      ? {
          otpRegenerateAllowedAfter: Math.round(
            getCurrentTimeInSeconds() +
              generalConstant.OTP_REGENERATE_TIME_IN_SECONDS
          ),
        }
      : {},
  });

  return generateToken({
    payload: preparedPayload,
    expiry: generalConstant.OTP_EXPIRE_TIME_IN_SECONDS,
    isRandomSecretKeyNeeded,
    tokenSecret,
  });
};

module.exports.generateHashedOTPToken = async ({secretKey}) => {
  let generatedOtp;

  if (config.get('env') === config.get('envVariables.prod'))
    generatedOtp = generateRandomString({numericOnly: true});
  else generatedOtp = config.get('defaultDevOtp');

  const hashedOtp = await hashString({
    string: generatedOtp,
  });

  const {token} = generateToken({
    payload: {otp: hashedOtp},
    expiry: generalConstant.OTP_EXPIRE_TIME_IN_SECONDS,
    tokenSecret: secretKey,
  });

  return {
    plainOtp: generatedOtp,
    token,
  };
};

exports.verifyHashedOtp = async ({inputOtp, hashedOtp}) => {
  const {success, response, error} = await asyncTryCatch({
    fn: async () =>
      await compareHashedString({
        simpleString: inputOtp,
        hashedString: hashedOtp,
      }),
  });

  return {success, isOtpVerified: response, error};
};

exports.createOTPs = async ({neededOTPs}) => {
  const finalResponse = {
    plainOtpForEmail: null,
    otpJwtTokenForEmail: null,
    plainOtpForPhone: null,
    otpJwtTokenForPhone: null,
  };

  const generatedDbOTPSecretKey = generateRandomString({
    length: secretKeyLength,
  });

  if (neededOTPs?.email) {
    const {plainOtp, token} = await this.generateHashedOTPToken({
      secretKey: generatedDbOTPSecretKey,
    });

    finalResponse.plainOtpForEmail = plainOtp;
    finalResponse.otpJwtTokenForEmail = token;
  }

  if (neededOTPs?.phone) {
    const {plainOtp, token} = await this.generateHashedOTPToken({
      secretKey: generatedDbOTPSecretKey,
    });

    finalResponse.plainOtpForPhone = plainOtp;
    finalResponse.otpJwtTokenForPhone = token;
  }

  return safeMerge({
    originalObj: finalResponse,
    newObj: {dbSecretKey: generatedDbOTPSecretKey},
  });
};

exports.verifyOtpForType = async ({OTPs, secretKeys, inputData, type}) => {
  const otpToken = OTPs?.[type];
  if (!otpToken) return false;

  const verifiedToken = verifyToken({
    token: otpToken,
    dbSecretKey: secretKeys?.otp,
  });

  if (!verifiedToken) return false;

  const {success, isOtpVerified, error} = await this.verifyHashedOtp({
    inputOtp: inputData[`${type}Otp`],
    hashedOtp: verifiedToken.otp,
  });

  if (!success) throw error;

  return isOtpVerified;
};

exports.verifyOTPs = async ({
  OTPs,
  secretKeys,
  neededVerificationForOTPs,
  inputData,
}) => {
  const finalResponse = {
    isOTPsInvalidOrExpired: false,
    isOTPsVerified: false,
    error: null,
  };
  if (neededVerificationForOTPs?.email) {
    const emailOtpVerified = await this.verifyOtpForType({
      OTPs,
      secretKeys,
      inputData,
      type: 'email',
    });

    if (!emailOtpVerified)
      return safeMerge({
        originalObj: finalResponse,
        newObj: {isOTPsInvalidOrExpired: true},
      });
  }
  if (neededVerificationForOTPs?.phone) {
    const phoneOtpVerified = await this.verifyOtpForType({
      OTPs,
      secretKeys,
      inputData,
      type: 'phone',
    });

    if (!phoneOtpVerified)
      return safeMerge({
        originalObj: finalResponse,
        newObj: {isOTPsInvalidOrExpired: true},
      });
  }

  return safeMerge({
    originalObj: finalResponse,
    newObj: {isOTPsVerified: true},
  });
};

module.exports.verifyRegenerateOtpTokenAllowed = ({decodedToken}) => {
  const now = getCurrentTimeInSeconds();

  const isOtpRegenerationAllowed =
    now >= decodedToken.otpRegenerateAllowedAfter;

  return {isOtpRegenerationAllowed};
};
