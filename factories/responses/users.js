const AppResponse = require('./app');

const {USER_SUCCESS_TYPES} = require('../../constants/responses/success/users');

const {
  getProfileByRole,
  isPendingMembership,
  resolveRosterStatus,
  resolveInvitationStatus,
  resolveMembershipInvitationStatus,
} = require('../../utils/userHelpers');

/**
 * Flattens one UserOrganization row into a roster row.
 */
const prepareRosterRow = ({membership, conflictUserIds}) => {
  const {user, role} = membership;
  const profile = getProfileByRole({user, role});

  const isPending = isPendingMembership({membership});

  return {
    id: membership.id,
    userId: user?.id ?? null,
    profileId: profile?.id ?? null,

    // Person details are per organization, so they come from the membership.
    firstName: membership.firstName ?? null,
    lastName: membership.lastName ?? null,
    email: user?.email ?? null,
    phoneNo: membership.phoneNo ?? null,
    role,
    status: resolveRosterStatus({user, profile}),
    source: profile?.source ?? null,

    invitationStatus: isPending
      ? resolveMembershipInvitationStatus({membership})
      : resolveInvitationStatus({
          user,
          role,
          hasEmailConflict: conflictUserIds.has(user?.id),
        }),
    invitationSentAt: isPending
      ? membership.invitationSentAt
      : (user?.invitationSentAt ?? null),

    isVerified: user?.isVerified ?? false,

    // Archiving soft-deletes the user and membership together; either marker
    // means the person is archived.
    archived: Boolean(user?.isDeleted || membership.isDeleted),

    // When this person joined the organization. The one field every role
    // carries and always has a value for, unlike regions or contact method.
    createdAt: membership.createdAt ?? null,
  };
};

const prepareUserResponse = ({user}) => {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phoneNo: user.phoneNo,
    address: user?.address,
    city: user?.city,
    zipCode: user?.zipCode,
    language: user?.language,
    currentActiveOrganization: user?.currentActiveOrganization,
    profileImage: user?.profileImage,
  };
};

module.exports = class UsersResponsesFactories {
  constructor() {}

  static userRegisteredSuccessfully() {
    return new AppResponse({
      message: 'User registered successfully',
      statusCode: 201,
      body: {type: USER_SUCCESS_TYPES.userRegisteredSuccessfully.value},
    });
  }

  static userLoggedInSuccessfully({user}) {
    const preparedUserResponse = prepareUserResponse({
      user: user,
    });

    return new AppResponse({
      message: 'User logged in successfully',
      statusCode: 200,
      body: {
        user: preparedUserResponse,
        type: USER_SUCCESS_TYPES.userLoggedInSuccessfully.value,
      },
    });
  }

  static singleUserInfoRetrievedRes({user} = {}) {
    const preparedUserResponse = prepareUserResponse({
      user: user,
    });

    return new AppResponse({
      message: 'User info retrieved successfully',
      statusCode: 200,
      body: {
        user: preparedUserResponse,
        type: USER_SUCCESS_TYPES.UserInfoRetrievedRes.value,
      },
    });
  }

  static resetPasswordLinkGeneratedSuccessfully() {
    return new AppResponse({
      message: 'Reset password link sent successfully',
      statusCode: 200,
      body: {
        type: USER_SUCCESS_TYPES.resetPasswordLinkGeneratedSuccessfully.value,
      },
    });
  }

  static passwordResetSuccessfully() {
    return new AppResponse({
      statusCode: 200,
      message: 'Password reset successfully',
      body: {type: USER_SUCCESS_TYPES.passwordResetSuccessfully.value},
    });
  }

  static logoutSuccessfully() {
    return new AppResponse({
      statusCode: 200,
      message: 'Logout successfully',
      body: {type: USER_SUCCESS_TYPES.logoutSuccessfully.value},
    });
  }

  static userVerifiedSuccessfully() {
    return new AppResponse({
      statusCode: 200,
      message: 'User verified successfully',
      body: {type: USER_SUCCESS_TYPES.userVerifiedSuccessfully.value},
    });
  }

  static resendVerificationEmail() {
    return new AppResponse({
      statusCode: 200,
      message: 'Email Verification sent successfully',
      body: {type: USER_SUCCESS_TYPES.verificationEmailSentSuccessfully.value},
    });
  }

  static invitationResent() {
    return new AppResponse({
      statusCode: 200,
      message: 'Invitation resent successfully',
      body: {type: USER_SUCCESS_TYPES.invitationResentSuccessfully.value},
    });
  }

  static invitationRevoked() {
    return new AppResponse({
      statusCode: 200,
      message: 'Invitation cancelled successfully',
      body: {type: USER_SUCCESS_TYPES.invitationRevokedSuccessfully.value},
    });
  }

  /** `results` holds one {userId, sent, reason?} per requested person. */
  static bulkInvitationsProcessed({results}) {
    return new AppResponse({
      statusCode: 200,
      message: 'Invitations processed',
      body: {
        results,
        sentCount: results.filter((result) => result.sent).length,
        skippedCount: results.filter((result) => !result.sent).length,
        type: USER_SUCCESS_TYPES.bulkInvitationsProcessed.value,
      },
    });
  }

  static languageUpdatedSuccessfully() {
    return new AppResponse({
      message: 'Language updated successfully',
      statusCode: 200,
      body: {type: USER_SUCCESS_TYPES.languageUpdatedSuccessfully.value},
    });
  }

  static otpRequired({token, OTPsRequired}) {
    return new AppResponse({
      message: 'OTP required',
      statusCode: 200,
      body: {
        token,
        OTPsRequired,
        type: USER_SUCCESS_TYPES.otpRequired.value,
      },
    });
  }

  static otpResentSuccessfully({token}) {
    return new AppResponse({
      message: 'OTP resent successfully',
      statusCode: 200,
      body: {
        token,
        type: USER_SUCCESS_TYPES.otpResentSuccessfully.value,
      },
    });
  }

  static profileUpdatedSuccessfully() {
    return new AppResponse({
      message: 'Profile updated successfully',
      statusCode: 200,
      body: {
        type: USER_SUCCESS_TYPES.profileUpdatedSuccessfully.value,
      },
    });
  }

  static accountUnlockEmailSentRes() {
    return new AppResponse({
      message: 'Account unlock link sent successfully',
      statusCode: 200,
      body: {
        type: USER_SUCCESS_TYPES.accountUnlockEmailSent.value,
      },
    });
  }

  static accountAlreadyUnlockedRes() {
    return new AppResponse({
      message: 'Your account is already unlocked. You can proceed to login.',
      statusCode: 200,
      body: {
        type: USER_SUCCESS_TYPES.accountAlreadyUnlocked.value,
      },
    });
  }

  static accountUnlockedSuccessfullyRes() {
    return new AppResponse({
      message: 'Account unlocked successfully. You can now log in.',
      statusCode: 200,
      body: {
        type: USER_SUCCESS_TYPES.accountUnlockedSuccessfully.value,
      },
    });
  }

  static adminStatsRetrieved({stats}) {
    return new AppResponse({
      message: 'Admin stats retrieved successfully',
      statusCode: 200,
      body: {
        stats,
        type: USER_SUCCESS_TYPES.adminStatsRetrieved.value,
      },
    });
  }

  static adminStatsTrendsRetrieved({trends}) {
    return new AppResponse({
      message: 'Admin stats trends retrieved successfully',
      statusCode: 200,
      body: {
        trends,
        type: USER_SUCCESS_TYPES.adminStatsTrendsRetrieved.value,
      },
    });
  }

  /**
   * Unified Users & Roles roster page.
   *
   * `tabCounts` are per-role totals that ignore the role filter, so the tabs
   * keep reading the same while one role is selected; `meta.count` is the
   * filtered total driving the pager.
   */
  static usersListRetrieved({
    memberships,
    meta,
    tabCounts,
    conflictUserIds = [],
  }) {
    const conflicts = new Set(conflictUserIds);

    return new AppResponse({
      message: 'Users list retrieved successfully',
      statusCode: 200,
      body: {
        users: memberships.map((membership) =>
          prepareRosterRow({membership, conflictUserIds: conflicts})
        ),
        meta,
        tabCounts,
        type: USER_SUCCESS_TYPES.usersListRetrieved.value,
      },
    });
  }

  static profileImageUploaded() {
    return new AppResponse({
      message: 'Profile image uploaded successfully',
      statusCode: 201,
      body: {
        type: USER_SUCCESS_TYPES.profileImageUploaded.value,
      },
    });
  }

  static profileImageUpdated() {
    return new AppResponse({
      message: 'Profile image updated successfully',
      statusCode: 200,
      body: {
        type: USER_SUCCESS_TYPES.profileImageUpdated.value,
      },
    });
  }

  static profileImageDeleted() {
    return new AppResponse({
      message: 'Profile image deleted successfully',
      statusCode: 200,
      body: {
        type: USER_SUCCESS_TYPES.profileImageDeleted.value,
      },
    });
  }
};
