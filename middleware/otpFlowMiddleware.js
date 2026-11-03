const {UsersErrorsFactories, UsersResponsesFactories} = require('../factories');
const SecurityServices = require('../services/securityServices');
const UsersServices = require('../services/usersServices');

const {
  otpUtils,
  jwtUtils,
  safeMerge,
  getExistingSecretKeys,
  getExistingOtps,
} = require('../utils');
const actions = require('../utils/actions');

module.exports = async (req, res, next) => {
  try {
    const user = req.extra.entities.user;

    if (!user) throw UsersErrorsFactories.userNotFoundErr();

    const {
      success,
      user: retrievedUser,
      error,
    } = await UsersServices.getUserById({
      id: user.id,
      options: {
        fieldsInclusion: {
          include: ['secretKeys', 'otps'],
        },
      },
    });

    if (!success) throw error;

    const otpMethods = await SecurityServices.getOtpMethodsForUser({
      userId: user.id,
    });

    if (!otpMethods.email && !otpMethods.phone) {
      next();

      return;
    }

    const inputData = req.body;

    if (
      (otpMethods.email && !inputData.emailOtp) ||
      (otpMethods.phone && !inputData.phoneOtp)
    ) {
      const {
        plainOtpForEmail,
        otpJwtTokenForEmail,
        plainOtpForPhone,
        otpJwtTokenForPhone,
        dbSecretKey,
      } = await otpUtils.createOTPs({neededOTPs: otpMethods});

      // FIX: Merge with existing secretKeys and otps to preserve other fields
      const existingSecretKeys = getExistingSecretKeys({
        secretKeys: retrievedUser?.secretKeys,
      });
      const existingOtps = getExistingOtps({otps: retrievedUser?.otps});

      const updatedSecretKeys = safeMerge({
        originalObj: existingSecretKeys,
        newObj: {otp: dbSecretKey},
      });

      const updatedOtps = safeMerge({
        originalObj: existingOtps,
        newObj: {
          email: otpJwtTokenForEmail,
          phone: otpJwtTokenForPhone,
        },
      });

      const {success: updateSuccess, error: updateError} =
        await UsersServices.updateOne({
          id: retrievedUser.id,
          data: {
            otps: updatedOtps,
            secretKeys: updatedSecretKeys,
          },
        });

      if (!updateSuccess) throw updateError;

      await actions.users.sendOtp.multiple({
        user: safeMerge({
          originalObj: retrievedUser,
          newObj: {
            email: inputData.email ?? retrievedUser.email,

            // A new number is the one verified; otherwise the phone the
            // person has in the session's organization.
            phoneNo: inputData.phoneNo ?? user.phoneNo,
          },
        }),
        OTPs: {email: plainOtpForEmail, phone: plainOtpForPhone},
      });

      const {token} = otpUtils.generateOtpJwtToken({
        payload: {
          user: {id: retrievedUser.id},
          isOtpForEmail: otpMethods.email,
          isOtpForPhone: otpMethods.phone,
        },
        isRegenerateAllowTimeNeeded: true,
      });

      req.extra.flags.isOtpResponse = true;

      //Special Case: Send OTP required response as error to skip further processing and be handled by error middleware
      throw UsersResponsesFactories.otpRequired({
        token,
        OTPsRequired: {
          email: otpMethods.email,
          phone: otpMethods.phone,
        },
      });
    }

    if (!inputData.token) throw UsersErrorsFactories.otpInvalidOrExpiredErr();

    const decodedInputToken = jwtUtils.verifyToken({
      token: inputData.token,
    });

    if (!decodedInputToken) throw UsersErrorsFactories.otpInvalidOrExpiredErr();

    // Get OTPs from JSON structure for otpUtils compatibility
    const OTPs = {
      email: retrievedUser.otps?.email,
      phone: retrievedUser.otps?.phone,
    };

    const secretKeys = {
      otp: retrievedUser.secretKeys?.otp,
    };

    const {
      error: OTPsVerificationErr,
      isOTPsInvalidOrExpired,
      isOTPsVerified,
    } = await otpUtils.verifyOTPs({
      OTPs,
      secretKeys,
      neededVerificationForOTPs: {
        email: otpMethods.email,
        phone: otpMethods.phone,
      },
      inputData,
    });

    if (OTPsVerificationErr) throw OTPsVerificationErr;

    if (isOTPsInvalidOrExpired || !isOTPsVerified)
      throw UsersErrorsFactories.otpInvalidOrExpiredErr();

    // FIX: Merge with existing secretKeys and otps to preserve other fields
    const existingSecretKeys = getExistingSecretKeys({
      secretKeys: retrievedUser?.secretKeys,
    });
    const existingOtps = getExistingOtps({otps: retrievedUser?.otps});

    const updatedSecretKeys = safeMerge({
      originalObj: existingSecretKeys,
      newObj: {otp: null},
    });

    const updatedOtps = safeMerge({
      originalObj: existingOtps,
      newObj: {
        email: null,
        phone: null,
      },
    });

    const {success: finalUpdateSuccess, error: finalUpdateError} =
      await UsersServices.updateOne({
        id: retrievedUser.id,
        data: {
          otps: updatedOtps,
          secretKeys: updatedSecretKeys,
        },
      });

    if (!finalUpdateSuccess) throw finalUpdateError;

    req.extra.flags.needsToFetchUserInRefreshTokenMiddleware = true;

    next();
  } catch (error) {
    if (req?.extra?.appResponse) req.extra.appResponse = undefined;

    req.extra.entities = {};

    next(error);
  }
};
