const AppError = require('./app');

const {USER_ERRORS_TYPES} = require('../../constants/responses/errors/users');

module.exports = class UsersErrorsFactories {
  static userAlreadyRegisteredErr() {
    return new AppError({
      message: 'user already registered',
      statusCode: 409,
      error: {type: USER_ERRORS_TYPES.userAlreadyRegistered.value},
    });
  }

  static userAlreadyHasRoleErr({role} = {}) {
    return new AppError({
      message: role
        ? `User already has an active ${role} role in this organization`
        : 'User already has this role in the organization',
      statusCode: 409,
      error: {type: USER_ERRORS_TYPES.userAlreadyHasRole.value},
    });
  }

  static userNotFoundErr() {
    return new AppError({
      message: 'user not found',
      statusCode: 404,
      error: {type: USER_ERRORS_TYPES.userNotFound.value},
    });
  }

  static wrongEmailOrPasswordErr() {
    return new AppError({
      message: 'wrong credentials',
      statusCode: 401,
      error: {type: USER_ERRORS_TYPES.wrongEmailOrPassword.value},
    });
  }

  static invalidTokenErr() {
    return new AppError({
      message:
        'Token is either expired or is invalid. Please create a new token and try again',
      statusCode: 401,
      error: {type: USER_ERRORS_TYPES.invalidToken.value},
    });
  }

  static loginResetTokenUserErr() {
    return new AppError({
      message:
        'Password reset failed. Either the reset link is already used or the user is deleted',
      statusCode: 400,
      error: {type: USER_ERRORS_TYPES.passwordResetFailed.value},
    });
  }

  static userNotVerifiedErr() {
    return new AppError({
      message: 'User Not Verified',
      statusCode: 400,
      error: {
        type: USER_ERRORS_TYPES.userNotVerified.value,
      },
    });
  }

  static userAlreadyVerifiedErr() {
    return new AppError({
      message: 'user already verified',
      statusCode: 400,
      error: {type: USER_ERRORS_TYPES.userAlreadyVerified.value},
    });
  }

  static otpInvalidOrExpiredErr() {
    return new AppError({
      message: 'OTP is invalid or has expired',
      statusCode: 401,
      error: {type: USER_ERRORS_TYPES.otpInvalidOrExpired.value},
    });
  }

  static otpRegenerateTooSoonErr() {
    return new AppError({
      message: 'OTP regeneration attempted too soon.',
      statusCode: 401,
      error: {
        type: USER_ERRORS_TYPES.otpRegenerateTooSoon.value,
      },
    });
  }

  static wrongCurrentPasswordErr() {
    return new AppError({
      message: 'Your current password is wrong',
      statusCode: 400,
      error: {type: USER_ERRORS_TYPES.wrongCurrentPasswordErr.value},
    });
  }

  static emailAlreadyRegisteredErr() {
    return new AppError({
      message: 'Email already registered',
      statusCode: 400,
      error: {type: USER_ERRORS_TYPES.emailAlreadyRegistered.value},
    });
  }

  static userCreationFailedErr() {
    return new AppError({
      message: 'Unable to create user account. Please try again',
      statusCode: 500,
      error: {type: USER_ERRORS_TYPES.userCreationFailed.value},
    });
  }

  static accountLockedErr() {
    return new AppError({
      message:
        'Your account has been locked due to too many failed login attempts. Please request an unlock link to regain access.',
      statusCode: 423,
      error: {type: USER_ERRORS_TYPES.accountLocked.value},
    });
  }

  /** `status` is the organization's status; it decides what the person is told. */
  static organizationNotApprovedErr({status} = {}) {
    const messageByStatus = {
      rejected:
        'Your organization was not approved, so nobody in it can log in.',
      suspended:
        'Your organization has been suspended. You can log in again once it is reactivated.',
    };

    return new AppError({
      message:
        messageByStatus[status] ||
        'Your organization is waiting for approval. You can log in once it has been approved.',
      statusCode: 403,
      error: {type: USER_ERRORS_TYPES.organizationNotApproved.value},
    });
  }

  static verificationTokenSaveFailedErr() {
    return new AppError({
      message: 'Unable to process your request. Please try again',
      statusCode: 500,
      error: {type: USER_ERRORS_TYPES.verificationTokenSaveFailed.value},
    });
  }

  static invitationTokenSaveFailedErr() {
    return new AppError({
      message: 'Unable to process your request. Please try again',
      statusCode: 500,
      error: {type: USER_ERRORS_TYPES.invitationTokenSaveFailed.value},
    });
  }

  static invitationStillActiveErr({expiresAt} = {}) {
    return new AppError({
      message: `An invitation was already sent and is still active. Please wait until ${expiresAt} before resending.`,
      statusCode: 429,
      error: {
        type: USER_ERRORS_TYPES.invitationStillActive.value,
        expiresAt,
      },
    });
  }

  /** `reason` is an INVITE_BLOCK_REASONS member. */
  static userNotInvitableErr({reason}) {
    return new AppError({
      message: reason.label,
      statusCode: 400,
      error: {
        type: USER_ERRORS_TYPES.userNotInvitable.value,
        reason: reason.value,
      },
    });
  }

  static noActiveInvitationErr() {
    return new AppError({
      message: 'This person has no invitation to cancel',
      statusCode: 400,
      error: {type: USER_ERRORS_TYPES.noActiveInvitation.value},
    });
  }

  static sessionNotFoundErr() {
    return new AppError({
      message: 'Session not found',
      statusCode: 404,
      error: {type: USER_ERRORS_TYPES.sessionNotFound.value},
    });
  }

  static profileImageAlreadyExistsErr() {
    return new AppError({
      message:
        'Profile image already exists. Use the update endpoint to replace it',
      statusCode: 409,
      error: {type: USER_ERRORS_TYPES.profileImageAlreadyExists.value},
    });
  }

  static profileImageNotFoundErr() {
    return new AppError({
      message: 'No profile image found',
      statusCode: 404,
      error: {type: USER_ERRORS_TYPES.profileImageNotFound.value},
    });
  }
};
