const config = require('config');

const {
  usersConstants,
  generalConstant: {TOKEN_TYPES, maxFailedLoginAttempts},
  auditConstants: {AUDIT_OPERATIONS},
} = require('../constants');

const {NURSE_SOURCES} = require('../constants/nursesConstants');
const {UsersControllerHelpers} = require('../helpers');

const CaregiversController = require('./caregiversController');
const CaseManagersController = require('./caseManagersController');
const NursesController = require('./nursesController');

const {
  SYSTEM_ENTITIES,
  CRUD_PERMISSIONS,
} = require('../constants/aclConstants');
const {CAREGIVER_SOURCES} = require('../constants/caregiversConstants');
const {CASE_MANAGER_SOURCES} = require('../constants/caseManagersConstants');

const {
  HHA_MANAGED_CAREGIVER_FIELDS,
  HHA_MANAGED_CASE_MANAGER_FIELDS,
  HHA_MANAGED_NURSE_FIELDS,
} = require('../constants/hhaExchangeConstants');
const {ORGANIZATION_STATUSES} = require('../constants/organizationsConstants');
const {AUDIT_ROUTE_CONFIG} = require('../constants/requestLoggerConstants');

const {INVITE_BLOCK_REASONS, BULK_INVITATION_CONCURRENCY} = usersConstants;

const {
  UsersErrorsFactories,
  GeneralErrorsFactories,
  GeneralResponsesFactories,
  UsersResponsesFactories,
} = require('../factories');
const {toReportScope} = require('../helpers/reportContextHelpers');

const {
  UsersServices,
  SessionsServices,
  AuditServices,
  CaregiversServices,
  CaseManagersServices,
  NursesServices,
  OrganizationsServices,
  OrganizationInvitationsServices,
  HhaCredentialsServices,
  HhaSyncHistoryReadServices,
  HhaSyncWorklistServices,
} = require('../services');

const {
  jwtUtils,
  getLocaleFromCookie,
  userUtils,
  otpUtils,
  isDocumentDuplicationError,
  isDocumentNotFoundError,
  safeMerge,
  getExistingSecretKeys,
  getExistingOtps,
} = require('../utils');
const {checkStaticPermissions} = require('../utils/aclUtils');

const actions = require('../utils/actions');
const {getCurrentTime} = require('../utils/dateUtils');

const {extractTokenFromReqBasedOnPlatform} = require('../utils/extraReqUtils');

const {
  getListParams,
  buildOrderByClause,
  chunkArray,
} = require('../utils/general');
const {getTokenHeaderName} = require('../utils/getTokenHeaderUtils');

const {
  assertHhaManagedFieldsNotEdited,
  getEditedHhaManagedFields,
} = require('../utils/hhaExchange/managedFieldsUtils');
const {wrapWithPrismaTransaction} = require('../utils/prismaTransactionUtils');

const {asyncTryCatch} = require('../utils/tryCatchUtils');
const {getCookieDomain} = require('../utils/urlUtils');

const {
  applySessionOrganization,
  enrichUserObject,
  isInvitationActive,
  isPendingMembership,
  getInvitationExpiry,
  cleanUserResponse,
  isRoleProfileInactive,
  buildProfileRelationsInclude,
  buildEmailedLinksInvalidation,
} = require('../utils/userHelpers');

const {
  uploadProfileImage,
  cleanupProfileImage,
} = require('../utils/userProfileImageUtils');

// Each roster role is gated by its own ACL entity, so the list must not show a
// role slice the caller cannot view on that role's own page.
const ROSTER_ROLE_ACL_ENTITIES = {
  [usersConstants.SYSTEM_ROLES.nurse.value]: SYSTEM_ENTITIES.nurse.value,
  [usersConstants.SYSTEM_ROLES.caregiver.value]:
    SYSTEM_ENTITIES.caregiver.value,
  [usersConstants.SYSTEM_ROLES.case_manager.value]:
    SYSTEM_ENTITIES.caseManager.value,
};

const INVITE_HANDLER_BY_USER_TYPE = {
  [usersConstants.SYSTEM_ROLES.nurse.value]: NursesController.inviteNurse,
  [usersConstants.SYSTEM_ROLES.caregiver.value]:
    CaregiversController.inviteCaregiver,
  [usersConstants.SYSTEM_ROLES.case_manager.value]:
    CaseManagersController.inviteCaseManager,
};

const decodeAndVerifyTokenAction = async ({
  token,
  secretKey = 'loginReset',
  tokenCanNotBeVerifiedErr = GeneralErrorsFactories.invalidTokenErr(),
}) => {
  const decodedToken = jwtUtils.decodeToken({token});

  if (!decodedToken) throw tokenCanNotBeVerifiedErr;

  // Get user with secretKeys JSON field for verification
  const {user} = await UsersServices.getUserById({
    id: decodedToken.user.id,
    options: {
      fieldsInclusion: {
        include: ['secretKeys'],
      },
    },
  });

  if (!user || !user?.secretKeys?.[secretKey]) throw tokenCanNotBeVerifiedErr;

  const verifiedTokenData = jwtUtils.verifyToken({
    token,
    dbSecretKey: user.secretKeys[secretKey],
  });

  if (!verifiedTokenData) throw tokenCanNotBeVerifiedErr;

  return {user: enrichUserObject({user}), verifiedTokenData};
};

/** Users an open email exception keeps from being invited. Fails closed. */
const loadEmailConflictUserIds = async ({organizationId}) => {
  const {success, userIds, error} =
    await HhaSyncHistoryReadServices.listUserIdsWithOpenEmailException({
      organizationId,
    });

  if (!success) throw error;

  return new Set(userIds);
};

/** The person and their role in this organization, or {} when not a member. */
const findOrgUserForInvitation = async ({userId, organizationId}) => {
  const {success, user, error} = await UsersServices.getUserById({
    id: userId,
    options: {
      fieldsInclusion: {
        include: Object.assign(
          {userOrganizations: true, permissions: true, secretKeys: true},
          buildProfileRelationsInclude({organizationId})
        ),
      },
    },
  });

  if (!success) throw error;

  const membership = user?.userOrganizations?.find(
    (userOrg) => userOrg.organizationId === organizationId
  );

  return membership ? {user, role: membership.role, membership} : {};
};

/**
 * Refuses an organization that is not active. A missing organization counts as
 * not active, so this fails closed.
 */
const assertOrganizationIsActive = async ({organizationId}) => {
  const {
    success,
    doc: organization,
    error,
  } = await OrganizationsServices.getOrganizationById({id: organizationId});

  if (!success) throw error;

  if (organization?.status !== ORGANIZATION_STATUSES.ACTIVE.value) {
    throw UsersErrorsFactories.organizationNotApprovedErr({
      status: organization?.status,
    });
  }
};

/**
 * The pending membership an emailed link was signed for. A 400, not the 401 of
 * the other token errors: the client treats a 401 as an ended session and would
 * log them out.
 */
const loadOrganizationInvitationOrThrow = async ({req}) => {
  const {success, membership, error} =
    await OrganizationInvitationsServices.getInvitationByToken({
      token: req.params.token,
    });

  if (!success) throw error;

  if (!membership) {
    throw GeneralErrorsFactories.badRequestErr({
      customMessage: 'This invitation is invalid or has expired.',
    });
  }

  return membership;
};

module.exports = class UsersController {
  static async createUser(req, res, next) {
    const {organizationName, ...data} = req.body;

    // A new account starts without a main organization, which the unique email
    // index does not compare, so an email already in use is refused here.
    const {
      success,
      user: existingUser,
      error: lookupError,
    } = await UsersServices.getUserByEmail({email: data.email});

    if (!success) throw lookupError;

    if (existingUser) throw UsersErrorsFactories.userAlreadyRegisteredErr();

    const user = await UsersControllerHelpers.addUserToSystem({
      dataToCreateOrUpdate: data,
      organizationName,
      role: usersConstants.SYSTEM_ROLES.admin.value,
    });

    UsersControllerHelpers.sendVerificationEmail({user});

    // Signup is a public route, so the audit middleware may not have set up
    // the audit context.
    if (req.extra.audit) req.extra.audit.createdId = user.id;

    return UsersResponsesFactories.userRegisteredSuccessfully();
  }

  /**
   * Single entry point for every invitation. The user type comes from the query
   * string and selects the profile controller that does the work — the body was
   * already validated against that same type's invite schema.
   */
  static async inviteUser(req, res, next) {
    const {userType} = req.query;

    UsersControllerHelpers.applyInviteAuditTarget({req, userType});

    return INVITE_HANDLER_BY_USER_TYPE[userType](req, res, next);
  }

  static async verifyInvitedUser(req, res, next) {
    const {firstName, lastName, password} = req.body;
    const token = req.params.token;

    const {user} = await decodeAndVerifyTokenAction({
      token,
      secretKey: 'invitation',

      tokenCanNotBeVerifiedErr: UsersErrorsFactories.invalidTokenErr(),
    });

    // FIX: Preserve other secretKeys when clearing invitation to avoid data loss
    const existingSecretKeys = getExistingSecretKeys({
      secretKeys: user.secretKeys,
    });

    const updatedSecretKeys = safeMerge({
      originalObj: existingSecretKeys,
      newObj: {invitation: null, invitationSentAt: null},
    });

    const data = {
      password,
      isVerified: true,
      secretKeys: updatedSecretKeys,
      invitationAcceptedAt: getCurrentTime(),
    };

    if (firstName) data.firstName = firstName;
    if (lastName) data.lastName = lastName;

    const {success, error: updateErr} = await UsersServices.updateOne({
      id: user.id,
      data,
    });

    if (!success) throw updateErr;

    // The name they entered is their name in the organization that invited them.
    const invitedOrganizationId =
      user.currentActiveOrganization?.organizationId;

    if (invitedOrganizationId && (firstName || lastName)) {
      const {error: membershipErr} =
        await UsersServices.updateMembershipDetails({
          userId: user.id,
          organizationId: invitedOrganizationId,
          data: {firstName, lastName},
        });

      if (membershipErr) throw membershipErr;
    }

    // The person can log in now, so they get the patients HHAeXchange assigns them.
    const assignedPatientCount =
      await HhaSyncWorklistServices.applyPendingLinksForUser({userId: user.id});

    // No session yet, so the actor and org are named explicitly.
    await AuditServices.logAudit({
      action: AUDIT_OPERATIONS.INVITE_ACCEPTED.value,
      userId: user.id,
      organizationId: user.currentActiveOrganization?.organizationId || null,
      resourceName: AUDIT_ROUTE_CONFIG.users.resource,
      resourceId: user.id,
      context: assignedPatientCount > 0 ? {assignedPatientCount} : undefined,
    });

    // Auto-login: set user entity + flags so refreshTokenMiddleware creates
    // a session and generates the auth cookie for it
    req.extra.entities.user = user;
    req.extra.flags.needsToFetchUserInRefreshTokenMiddleware = true;
    req.extra.flags.needsToCreateSession = true;

    return UsersResponsesFactories.userVerifiedSuccessfully();
  }

  /**
   * The person joins the organization that invited them, straight from the
   * emailed link and without logging in. Their account and password are
   * untouched and no session is created.
   */
  static async acceptOrganizationInvitation(req, res, next) {
    const membership = await loadOrganizationInvitationOrThrow({req});

    const {success, error} = await wrapWithPrismaTransaction({
      fn: async (tx) =>
        OrganizationInvitationsServices.acceptInvitation({membership, tx}),
    });

    if (!success) throw error;

    // There is no session on this request, so the person and the invited
    // organization are named explicitly.
    await AuditServices.logAudit({
      action: AUDIT_OPERATIONS.INVITE_ACCEPTED.value,
      userId: membership.userId,
      organizationId: membership.organizationId,
      resourceName: AUDIT_ROUTE_CONFIG.users.resource,
      resourceId: membership.userId,
    });

    return GeneralResponsesFactories.dataUpdatedSuccessfully({
      data: {
        organizationId: membership.organizationId,
        organizationName: membership.organization.organizationName,
      },
      key: 'invitation',
    });
  }

  static async getLoggedInUserInformation(req, res, next) {
    const {success, user, error} = await UsersServices.getUserById({
      id: req.extra.jwtToken.user.id,
      options: {
        fieldsInclusion: {
          // Include userOrganizations so currentActiveOrganization virtual is available
          include: ['userOrganizations'],
        },
      },
    });

    if (!success) throw error;

    if (!user) throw UsersErrorsFactories.userNotFoundErr();

    // Same organization the token carries, not the main one.
    applySessionOrganization({
      user,
      session: req.extra.entities.session,
    });

    const sanitizedUser = userUtils.sanitizeUser({user});
    const activeOrganization = sanitizedUser.currentActiveOrganization;

    // Every role reads the organization's zone from here; the organization
    // endpoints themselves are not open to caregivers. The field is a getter
    // that recomputes on every read, so it is replaced, not mutated.
    if (activeOrganization?.organizationId) {
      const [timeZone, hhaConnection] = await Promise.all([
        OrganizationsServices.getOrganizationTimeZone({
          id: activeOrganization.organizationId,
        }),
        HhaCredentialsServices.isConnected({
          organizationId: activeOrganization.organizationId,
        }),
      ]);

      // A failed lookup is an error, not "HHA is off".
      if (!hhaConnection.success) throw hhaConnection.error;

      Object.defineProperty(sanitizedUser, 'currentActiveOrganization', {
        value: Object.assign({}, activeOrganization, {
          timeZone,

          // The frontend hides the HHAeXchange screens unless this is true.
          hhaEnabled: hhaConnection.isConnected,
        }),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }

    return UsersResponsesFactories.singleUserInfoRetrievedRes({
      user: sanitizedUser,
    });
  }

  /**
   * The organizations the person can work in: accepted memberships of active
   * organizations. Pending invitations and organizations that are not active
   * are left out, since they cannot be switched to.
   */
  static async getMyOrganizations(req, res, next) {
    const {success, user, error} = await UsersServices.getUserById({
      id: req.extra.jwtToken.user.id,
      options: {
        fieldsInclusion: {
          include: {
            userOrganizations: {
              include: {
                organization: {
                  select: {id: true, organizationName: true, status: true},
                },
              },
            },
          },
        },
      },
    });

    if (!success) throw error;

    if (!user) throw UsersErrorsFactories.userNotFoundErr();

    const currentOrganizationId =
      req.extra.jwtToken.user.currentActiveOrganization?.organizationId;

    const organizations = (user.userOrganizations || [])
      .filter(
        (membership) =>
          membership.isActive &&
          membership.organization?.status === ORGANIZATION_STATUSES.ACTIVE.value
      )
      .map((membership) => ({
        organizationId: membership.organizationId,
        organizationName: membership.organization.organizationName,
        role: membership.role,
        isCurrent: membership.organizationId === currentOrganizationId,
        isMain: membership.organizationId === user.primaryOrgId,
      }));

    return GeneralResponsesFactories.dataRetrievedSuccessfully({
      data: organizations,
      key: 'organizations',
    });
  }

  /**
   * Moves this login (one session, not the person's other devices) into
   * another organization the person belongs to. The new token is signed by
   * refreshTokenMiddleware at the end of this request.
   */
  static async switchOrganization(req, res, next) {
    const {organizationId} = req.body;

    const {user, session} = req.extra.entities;

    // authMiddleware loaded every membership with its organization's status and
    // every role profile, so nothing else is read here.
    const membership = (user.userOrganizations || []).find(
      (item) => item.organizationId === organizationId && item.isActive
    );

    if (!membership) throw GeneralErrorsFactories.forbiddenErr();

    if (membership.organization?.status !== ORGANIZATION_STATUSES.ACTIVE.value)
      throw UsersErrorsFactories.organizationNotApprovedErr({
        status: membership.organization?.status,
      });

    if (isRoleProfileInactive({user, role: membership.role, organizationId}))
      throw GeneralErrorsFactories.accountInactiveErr();

    const {success, error} = await SessionsServices.setActiveOrganization({
      id: session.id,
      userId: user.id,
      organizationId,
    });

    if (!success) throw error;

    session.activeOrganizationId = organizationId;

    req.extra.flags.needsToFetchUserInRefreshTokenMiddleware = true;

    return GeneralResponsesFactories.dataUpdatedSuccessfully({
      data: {organizationId, role: membership.role},
      key: 'organization',
    });
  }

  static async loginUser(req, res, next) {
    const inputData = req.body;

    const {
      success: isSuccessful,
      user: userToLogin,
      error,
    } = await UsersServices.getUserByEmail({
      email: inputData.email,

      // secretKeys is included as the user will be set in the entities and further used by the refresh token and needs the auth to refresh
      optionsInclude: ['password', 'userOrganizations', 'secretKeys'],
      includeProfileRelations: true,
    });

    if (!isSuccessful) throw error;

    if (!userToLogin || !userToLogin.password)
      throw UsersErrorsFactories.wrongEmailOrPasswordErr();

    // Set user entity early so the audit logger can capture userId and
    // organizationId even when subsequent checks (locked, wrong password) throw.
    req.extra.entities.user = userToLogin;

    // Check if account is locked before verifying password
    if (userToLogin.lockedAt) throw UsersErrorsFactories.accountLockedErr();

    const {
      success,
      isPasswordVerified,
      error: verificationError,
    } = await UsersServices.verifyUserPassword({
      inputPassword: inputData.password,
      dbPassword: userToLogin.password,
    });

    if (!success) throw verificationError;

    if (!isPasswordVerified) {
      // Increment failed attempts
      const {success: incrementSuccess, failedLoginAttempts} =
        await UsersServices.incrementFailedLoginAttempts({
          id: userToLogin.id,
        });

      if (!incrementSuccess) throw GeneralErrorsFactories.internalErr();

      // Lock the account if max attempts reached
      if (failedLoginAttempts >= maxFailedLoginAttempts) {
        const {success: lockSuccess} = await UsersServices.lockAccount({
          id: userToLogin.id,
        });

        if (!lockSuccess) throw GeneralErrorsFactories.internalErr();

        AuditServices.logAudit({
          action: AUDIT_OPERATIONS.ACCOUNT_LOCK.value,
          userId: userToLogin.id,
          organizationId:
            userToLogin.currentActiveOrganization?.organizationId || null,
          context: {attemptedEmail: inputData.email},
        });

        throw UsersErrorsFactories.accountLockedErr();
      }

      throw UsersErrorsFactories.wrongEmailOrPasswordErr();
    }

    if (!userToLogin.isVerified)
      throw UsersErrorsFactories.userNotVerifiedErr();

    // Nobody in an organization still waiting for approval can log in, in any
    // role.
    const currentOrganizationId =
      userToLogin.currentActiveOrganization?.organizationId;

    if (currentOrganizationId) {
      await assertOrganizationIsActive({organizationId: currentOrganizationId});
    }

    // Block inactive role profiles from logging in (nurse, caregiver, case_manager)
    if (
      isRoleProfileInactive({
        user: userToLogin,
        role: userToLogin.currentActiveOrganization?.role,
      })
    )
      throw GeneralErrorsFactories.accountInactiveErr();

    // Reset failed login attempts on successful login
    if (userToLogin.failedLoginAttempts > 0) {
      const {success: resetSuccess} = await UsersServices.updateOne({
        id: userToLogin.id,
        data: {failedLoginAttempts: 0},
      });

      if (!resetSuccess) throw GeneralErrorsFactories.internalErr();
    }

    userToLogin.password = undefined;

    req.extra.entities.user = userToLogin;
    req.extra.flags.needsToFetchUserInRefreshTokenMiddleware = true;
    req.extra.flags.needsToCreateSession = true;

    return UsersResponsesFactories.userLoggedInSuccessfully({
      user: userUtils.sanitizeUser({user: userToLogin}),
    });
  }

  static async regenerateOtp(req, res, next) {
    const inputData = req.body;

    const decodedToken = jwtUtils.decodeToken({token: inputData.token});

    if (!decodedToken) throw UsersErrorsFactories.otpInvalidOrExpiredErr();

    const {isOtpRegenerationAllowed} = otpUtils.verifyRegenerateOtpTokenAllowed(
      {
        decodedToken,
      }
    );

    if (!isOtpRegenerationAllowed)
      throw UsersErrorsFactories.otpRegenerateTooSoonErr();

    const {
      success: isSuccessful,
      user: retrievedUser,
      error,
    } = await UsersServices.getUserById({
      id: decodedToken.user.id,
      options: {fieldsInclusion: {include: ['secretKeys', 'otps']}},
    });

    if (!isSuccessful) throw error;

    const {
      plainOtpForEmail,
      otpJwtTokenForEmail,
      plainOtpForPhone,
      otpJwtTokenForPhone,
      dbSecretKey,
    } = await otpUtils.createOTPs({
      neededOTPs: {
        email: decodedToken?.isOtpForEmail,
        phone: decodedToken?.isOtpForPhone,
      },
    });

    // FIX: Merge with existing otps and secretKeys to preserve other fields
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
          secretKeys: updatedSecretKeys,
          otps: updatedOtps,
        },
      });

    if (!updateSuccess) throw updateError;

    await actions.users.sendOtp.multiple({
      user: retrievedUser,
      OTPs: safeMerge({
        originalObj: decodedToken?.isOtpForEmail
          ? {email: plainOtpForEmail}
          : {},
        newObj: decodedToken?.isOtpForPhone ? {phone: plainOtpForPhone} : {},
      }),
    });

    const {token} = otpUtils.generateOtpJwtToken({
      payload: safeMerge({
        originalObj: {user: {id: retrievedUser.id}},
        newObj: safeMerge({
          originalObj: decodedToken?.isOtpForEmail ? {isOtpForEmail: true} : {},
          newObj: decodedToken?.isOtpForPhone ? {isOtpForPhone: true} : {},
        }),
      }),
      isRegenerateAllowTimeNeeded: true,
    });

    return UsersResponsesFactories.otpResentSuccessfully({
      token,
    });
  }

  static async forgetPassword(req, res, next) {
    const {success, user, error} = await UsersServices.getUserByEmail({
      email: req.body.email,
      optionsInclude: ['secretKeys', 'password'],
    });

    if (!success) throw error;

    if (!user)
      return UsersResponsesFactories.resetPasswordLinkGeneratedSuccessfully();

    // A reset verifies the account, so it would give a login to a person with
    // no open invitation: never invited, or expired. Same answer as unknown.
    const hasNoOpenAccess =
      !user.isVerified &&
      !user.password &&
      !isInvitationActive({sentAt: user.secretKeys?.invitationSentAt});

    if (hasNoOpenAccess)
      return UsersResponsesFactories.resetPasswordLinkGeneratedSuccessfully();

    // Generate the reset token - this creates a NEW secretKey internally
    const resetToken = user.generateToken({type: TOKEN_TYPES.loginReset.value});

    // After generateToken, user.secretKeys.loginReset contains the NEW secretKey that matches the token
    // We need to save this exact secretKey to the database
    const secretKey = user.secretKeys.loginReset;

    // Get existing secretKeys and merge with the new loginReset key
    const existingSecretKeys = getExistingSecretKeys({
      secretKeys: user.secretKeys,
    });

    const updatedSecretKeys = safeMerge({
      originalObj: existingSecretKeys,
      newObj: {loginReset: secretKey},
    });

    await UsersServices.updateOne({
      id: user.id,
      data: {
        secretKeys: updatedSecretKeys,
      },
    });

    await actions.users.resetPassword({
      user,
      resetToken,
      locale: getLocaleFromCookie({req}),
    });

    return UsersResponsesFactories.resetPasswordLinkGeneratedSuccessfully();
  }

  static async resetPassword(req, res, next) {
    const newPassword = req.body.password;
    const token = req.params.token;

    const {verifiedTokenData} = await decodeAndVerifyTokenAction({
      token,
      secretKey: 'loginReset',
      tokenCanNotBeVerifiedErr: UsersErrorsFactories.invalidTokenErr(),
    });

    const resetArgs = {
      id: verifiedTokenData.user.id,
      newPassword,
    };

    const {isDocumentUpdated, error} = await UsersServices.resetPassword({
      resetArgs,
    });

    if (isDocumentNotFoundError({error})) {
      throw UsersErrorsFactories.userNotFoundErr();
    }

    if (error) throw error;

    if (!isDocumentUpdated) throw UsersErrorsFactories.loginResetTokenUserErr();

    // A reset verifies the account, which is also how an invitation is accepted.
    await HhaSyncWorklistServices.applyPendingLinksForUser({
      userId: resetArgs.id,
    });

    await SessionsServices.deleteAllSessionsOfUser({userId: resetArgs.id});

    return UsersResponsesFactories.passwordResetSuccessfully();
  }

  static async logout(req, res, next) {
    // Extract user from JWT before clearing the cookie so audit logger
    // can capture userId and organizationId for the logout event.
    // NOTE: We set req.extra.jwtToken (not req.extra.entities.user) to avoid
    // triggering refreshTokenMiddleware, which would re-issue the cookie.

    const token = extractTokenFromReqBasedOnPlatform({req});

    if (token) {
      const decodedToken = jwtUtils.decodeToken({token});

      if (decodedToken) {
        req.extra.jwtToken = decodedToken;

        const userId = decodedToken?.user?.id;
        const sessionId = decodedToken?.sessionId;

        if (userId && sessionId) {
          await SessionsServices.deleteSessionById({id: sessionId, userId});
        }
      }
    }

    const BASE_URL = config.get('frontendURL');
    const cookieDomain = getCookieDomain({url: BASE_URL});
    const cookieName = getTokenHeaderName();

    res.clearCookie(
      cookieName,
      safeMerge({
        originalObj: {path: '/'},
        newObj: {domain: cookieDomain},
      })
    );

    return UsersResponsesFactories.logoutSuccessfully();
  }

  static async verifyUser(req, res, next) {
    const {token} = req.params;

    const {user, verifiedTokenData} = await decodeAndVerifyTokenAction({
      token,
      secretKey: 'verification',
      tokenCanNotBeVerifiedErr: UsersErrorsFactories.invalidTokenErr(),
    });

    if (user.isVerified) throw UsersErrorsFactories.userAlreadyVerifiedErr();

    const {error: verificationError, isDocumentUpdated} =
      await UsersServices.verifyUser({
        id: verifiedTokenData.user.id,
      });

    if (verificationError) throw verificationError;

    if (isDocumentUpdated) {
      await HhaSyncWorklistServices.applyPendingLinksForUser({
        userId: verifiedTokenData.user.id,
      });

      return UsersResponsesFactories.userVerifiedSuccessfully();
    }
  }

  static async regenerateVerifyToken(req, res, next) {
    const {email} = req.body;

    const {success, user, error} = await UsersServices.getUserByEmail({
      email,
      optionsInclude: ['secretKeys'],
    });

    if (!success) throw error;

    if (!user) throw UsersErrorsFactories.userNotFoundErr();

    // Check if user has a verification secret key - only regenerate if one exists
    // This prevents requesting verification tokens without having received one initially
    if (!user?.secretKeys?.verification)
      throw GeneralErrorsFactories.badRequestErr();

    // Generate new verification token (this sets secretKeys.verification on user object)
    const generatedToken = user.generateToken({
      type: TOKEN_TYPES.verification.value,
    });

    // Save the newly generated secret key to database
    // Fetch existing secretKeys to merge and preserve all keys
    const secretKey = user.secretKeys?.verification;

    const existingSecretKeys = getExistingSecretKeys({
      secretKeys: user.secretKeys,
    });

    const updatedSecretKeys = safeMerge({
      originalObj: existingSecretKeys,
      newObj: {verification: secretKey},
    });

    await UsersServices.updateOne({
      id: user.id,
      data: {
        secretKeys: updatedSecretKeys,
      },
    });

    await actions.users.verifyUser({user, token: generatedToken});

    return UsersResponsesFactories.resendVerificationEmail();
  }

  static async resendInvitation(req, res, next) {
    const {email} = req.body;

    const jwtToken = req.extra.jwtToken;

    const organizationId =
      jwtToken.user.currentActiveOrganization.organizationId;

    const {success, user, error} = await UsersServices.getUserByEmail({
      email,
      optionsInclude: ['secretKeys'],
      includeProfileRelations: true,
    });

    if (!success) throw error;

    if (!user) throw UsersErrorsFactories.userNotFoundErr();

    const userOrg = user.userOrganizations?.find(
      (uo) => uo.organizationId === organizationId
    );

    if (!userOrg) throw UsersErrorsFactories.userNotFoundErr();

    // An existing account invited into this organization: the invitation lives
    // on the membership, so it is resent from there.
    if (isPendingMembership({membership: userOrg})) {
      if (isInvitationActive({sentAt: userOrg.invitationSentAt})) {
        throw UsersErrorsFactories.invitationStillActiveErr({
          expiresAt: getInvitationExpiry({
            sentAt: userOrg.invitationSentAt,
          }).toISO(),
        });
      }

      await UsersControllerHelpers.sendInvitation({
        user,
        existingUser: user,
        invitingUser: jwtToken.user,
        role: userOrg.role,
        organizationId,
      });

      await AuditServices.logAudit({
        action: AUDIT_OPERATIONS.INVITE_RESENT.value,
        resourceName: AUDIT_ROUTE_CONFIG.users.resource,
        resourceId: user.id,
        context: {invitedEmail: user.email, role: userOrg.role},
      });

      return UsersResponsesFactories.invitationResent();
    }

    const conflictUserIds = await loadEmailConflictUserIds({organizationId});

    const {sent, reason, expiresAt} =
      await UsersControllerHelpers.inviteExistingUser({
        user,
        role: userOrg.role,
        invitingUser: jwtToken.user,
        hasEmailConflict: conflictUserIds.has(user.id),
        organizationId,
      });

    if (sent) return UsersResponsesFactories.invitationResent();

    if (reason === INVITE_BLOCK_REASONS.ALREADY_ACCEPTED) {
      throw UsersErrorsFactories.userAlreadyVerifiedErr();
    }

    if (reason === INVITE_BLOCK_REASONS.INVITATION_STILL_ACTIVE) {
      throw UsersErrorsFactories.invitationStillActiveErr({expiresAt});
    }

    throw UsersErrorsFactories.userNotInvitableErr({reason});
  }

  /**
   * Invites several existing people at once. One person who may not be invited
   * is skipped with a reason and never fails the others.
   */
  static async bulkInvite(req, res, next) {
    const {userIds} = req.body;

    const jwtToken = req.extra.jwtToken;

    const organizationId =
      jwtToken.user.currentActiveOrganization.organizationId;

    const conflictUserIds = await loadEmailConflictUserIds({organizationId});

    const inviteOne = async ({userId}) => {
      const {success, response} = await asyncTryCatch({
        fn: async () => {
          const {user, role, membership} = await findOrgUserForInvitation({
            userId,
            organizationId,
          });

          if (!user)
            return {sent: false, reason: INVITE_BLOCK_REASONS.NOT_FOUND};

          // An existing account invited into this organization is re-invited
          // from its membership, like a single resend.
          if (isPendingMembership({membership})) {
            if (isInvitationActive({sentAt: membership.invitationSentAt})) {
              return {
                sent: false,
                reason: INVITE_BLOCK_REASONS.INVITATION_STILL_ACTIVE,
              };
            }

            await UsersControllerHelpers.sendInvitation({
              user,
              existingUser: user,
              invitingUser: jwtToken.user,
              role,
              organizationId,
            });

            return {sent: true};
          }

          return UsersControllerHelpers.inviteExistingUser({
            user,
            role,
            invitingUser: jwtToken.user,
            hasEmailConflict: conflictUserIds.has(userId),
            organizationId,
          });
        },
      });

      const outcome = success
        ? response
        : {sent: false, reason: INVITE_BLOCK_REASONS.SEND_FAILED};

      return {
        userId,
        sent: outcome.sent,
        reason: outcome.reason?.value ?? null,
        message: outcome.reason?.label ?? null,
      };
    };

    const results = [];

    // A repeated id would race two sends for one person, so each goes once.
    const batches = chunkArray({
      items: Array.from(new Set(userIds)),
      size: BULK_INVITATION_CONCURRENCY,
    });

    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map((userId) => inviteOne({userId}))
      );

      batchResults.forEach((result) => results.push(result));
    }

    return UsersResponsesFactories.bulkInvitationsProcessed({results});
  }

  static async revokeInvitation(req, res, next) {
    const {userId} = req.body;

    const organizationId =
      req.extra.jwtToken.user.currentActiveOrganization.organizationId;

    const {user} = await findOrgUserForInvitation({userId, organizationId});

    if (!user) throw UsersErrorsFactories.userNotFoundErr();

    // An existing account invited into this organization: cancelling removes
    // the pending membership and its inactive profile, nothing else.
    const hasPendingMembership = user.userOrganizations?.some(
      (membership) =>
        membership.organizationId === organizationId &&
        isPendingMembership({membership})
    );

    if (hasPendingMembership) {
      const {success: removed, error: removeError} =
        await wrapWithPrismaTransaction({
          fn: async (tx) =>
            UsersServices.removeUserFromOrganization({
              userId: user.id,
              organizationId,
              tx,
            }),
        });

      if (!removed) throw removeError;

      await AuditServices.logAudit({
        action: AUDIT_OPERATIONS.INVITE_REVOKED.value,
        resourceName: AUDIT_ROUTE_CONFIG.users.resource,
        resourceId: user.id,
        context: {invitedEmail: user.email},
      });

      return UsersResponsesFactories.invitationRevoked();
    }

    if (user.isVerified) throw UsersErrorsFactories.userAlreadyVerifiedErr();

    if (!user.secretKeys?.invitationSentAt) {
      throw UsersErrorsFactories.noActiveInvitationErr();
    }

    const {success, error} = await UsersServices.updateOne({
      id: user.id,

      // A reset link requested while invited would still verify the account.
      data: buildEmailedLinksInvalidation({user}),
    });

    if (!success) throw error;

    await AuditServices.logAudit({
      action: AUDIT_OPERATIONS.INVITE_REVOKED.value,
      resourceName: AUDIT_ROUTE_CONFIG.users.resource,
      resourceId: user.id,
      context: {invitedEmail: user.email},
    });

    return UsersResponsesFactories.invitationRevoked();
  }

  static async deleteUser(req, res, next) {
    const userId = req.params.id;

    const {organizationId} = req.extra.jwtToken.user.currentActiveOrganization;

    // Scoped to the caller's organization, so a person elsewhere is not found.
    const {
      success,
      user,
      error: userError,
    } = await UsersServices.getUserById({
      id: userId,
      options: {fieldsInclusion: {include: ['userOrganizations']}},
    });

    if (!success) throw userError;

    if (!user) throw UsersErrorsFactories.userNotFoundErr();

    // The person leaves this organization only; their account is deleted just
    // when it was their last one.
    const {success: removed, error} = await wrapWithPrismaTransaction({
      fn: async (tx) =>
        UsersServices.removeUserFromOrganization({userId, organizationId, tx}),
    });

    if (!removed) throw error;

    // Clean user response - remove raw relations, keep virtual currentActiveOrganization
    const cleanedUser = cleanUserResponse({user});

    return GeneralResponsesFactories.dataDeletedSuccessfully({
      data: cleanedUser,
      key: 'user',
    });
  }

  static async sendUnlockEmail(req, res, next) {
    const {email} = req.body;

    const {success, user, error} = await UsersServices.getUserByEmail({
      email,
      optionsInclude: ['secretKeys'],
    });

    if (!success) throw error;

    // Return same generic response for non-existent or unlocked users to prevent email enumeration
    if (!user || !user.lockedAt)
      return UsersResponsesFactories.accountUnlockEmailSentRes();

    // Generate the unlock token — this creates a NEW secretKey, invalidating any previous unlock tokens
    const unlockToken = user.generateToken({
      type: TOKEN_TYPES.accountUnlock.value,
    });

    const secretKey = user.secretKeys.accountUnlock;

    const existingSecretKeys = getExistingSecretKeys({
      secretKeys: user.secretKeys,
    });

    const updatedSecretKeys = safeMerge({
      originalObj: existingSecretKeys,
      newObj: {accountUnlock: secretKey},
    });

    const {success: updateSuccess} = await UsersServices.updateOne({
      id: user.id,
      data: {secretKeys: updatedSecretKeys},
    });

    if (!updateSuccess) throw GeneralErrorsFactories.internalErr();

    const locale = getLocaleFromCookie({req});

    await actions.users.unlockAccount({
      user,
      unlockToken,
      locale,
    });

    return UsersResponsesFactories.accountUnlockEmailSentRes();
  }

  static async unlockAccount(req, res, next) {
    const {token} = req.params;

    const {user} = await decodeAndVerifyTokenAction({
      token,
      secretKey: 'accountUnlock',
      tokenCanNotBeVerifiedErr: UsersErrorsFactories.invalidTokenErr(),
    });

    const {success: unlockSuccess, error: unlockError} =
      await UsersServices.unlockAccount({id: user.id});

    if (!unlockSuccess) throw unlockError;

    AuditServices.logAudit({
      action: AUDIT_OPERATIONS.ACCOUNT_UNLOCK.value,
      userId: user.id,
      organizationId: user.currentActiveOrganization?.organizationId || null,
    });

    return UsersResponsesFactories.accountUnlockedSuccessfullyRes();
  }

  static async updateUserLanguage(req, res, next) {
    const userId = req.extra.jwtToken.user.id;
    const {language} = req.body;

    const updateArgs = {userId, language};

    const {success, error} = await UsersServices.updateUserLanguage({
      updateArgs,
    });

    if (!success) throw error;

    return UsersResponsesFactories.languageUpdatedSuccessfully();
  }

  static async updateProfile(req, res, next) {
    const loggedInUser = req.extra.jwtToken.user;
    const data = req.body;

    // Check if current password is provided
    const hasCurrentPassword = Boolean(data.currentPassword);

    const {
      success: isSuccessful,
      user: retrievedUser,
      error: gettingUserErr,
    } = await UsersServices.getUserById({
      id: loggedInUser.id,
      options: {
        fieldsInclusion: {
          include: [
            'password',
            'userOrganizations',
            'permissions',
            'secretKeys',
          ],
        },
      },
    });

    if (!isSuccessful) throw gettingUserErr;

    // Update the password
    if (hasCurrentPassword) {
      const {isPasswordVerified, error: verificationError} =
        await UsersServices.verifyUserPassword({
          inputPassword: data.currentPassword,
          dbPassword: retrievedUser.password,
        });

      if (verificationError) throw verificationError;

      if (!isPasswordVerified)
        throw UsersErrorsFactories.wrongCurrentPasswordErr();

      data.password = data.newPassword;
      data.currentPassword = undefined;
    }

    // A caregiver or case manager imported from HHAeXchange does not own their
    // own name -- HHAeXchange does, and the nightly sync overwrites it. This
    // endpoint is the ONLY self-service write path onto `users`, and it is
    // reachable by those users themselves, so without this check a synced
    // caregiver could change their own address here, or a synced case manager
    // their own name, and watch it revert overnight with no error.
    //
    // Patients need no equivalent guard: Patient is a standalone model with no
    // self-service endpoint. Caregivers and case managers need one precisely
    // because both profiles are User satellites.
    //
    // Checked BEFORE the lookup: most calls here are password changes or edits
    // by an admin or nurse, and none of those touch a managed field. Querying
    // first would put an extra round trip on every profile update in the system
    // to catch a case that almost never applies. Two role checks, each gated on
    // its own field list, so a caregiver-only field never costs a case manager
    // lookup and vice versa.
    const editedCaregiverFields = getEditedHhaManagedFields({
      body: data,
      managedFields: HHA_MANAGED_CAREGIVER_FIELDS,
    });

    if (editedCaregiverFields.length > 0) {
      const {
        success: isCaregiverLookupSuccessful,
        error: caregiverLookupError,
        doc: hhaManagedCaregiverProfile,
      } = await CaregiversServices.getCaregiverProfileByUser({
        userId: loggedInUser.id,
        additionalFilters: {source: CAREGIVER_SOURCES.HHA_EXCHANGE.value},
      });

      // Fail closed. The lookup returns an envelope rather than throwing, and
      // "no doc" is also what an unmanaged user looks like -- so a database
      // error here must not be read as "not managed, edit away".
      if (!isCaregiverLookupSuccessful) throw caregiverLookupError;

      assertHhaManagedFieldsNotEdited({
        body: data,
        isHhaManaged: Boolean(hhaManagedCaregiverProfile),
        managedFields: HHA_MANAGED_CAREGIVER_FIELDS,
      });
    }

    const editedCaseManagerFields = getEditedHhaManagedFields({
      body: data,
      managedFields: HHA_MANAGED_CASE_MANAGER_FIELDS,
    });

    if (editedCaseManagerFields.length > 0) {
      const {
        success: isCaseManagerLookupSuccessful,
        error: caseManagerLookupError,
        doc: hhaManagedCaseManagerProfile,
      } = await CaseManagersServices.getCaseManagerProfileByUser({
        userId: loggedInUser.id,
        additionalFilters: {source: CASE_MANAGER_SOURCES.HHA_EXCHANGE.value},
      });

      if (!isCaseManagerLookupSuccessful) throw caseManagerLookupError;

      assertHhaManagedFieldsNotEdited({
        body: data,
        isHhaManaged: Boolean(hhaManagedCaseManagerProfile),
        managedFields: HHA_MANAGED_CASE_MANAGER_FIELDS,
      });
    }

    // Third role, same rule: a NurseProfile is a User satellite too, and an
    // imported nurse's name and address are HHAeXchange's.
    const editedNurseFields = getEditedHhaManagedFields({
      body: data,
      managedFields: HHA_MANAGED_NURSE_FIELDS,
    });

    if (editedNurseFields.length > 0) {
      const {
        success: isNurseLookupSuccessful,
        error: nurseLookupError,
        doc: hhaManagedNurseProfile,
      } = await NursesServices.getNurseProfileByUser({
        userId: loggedInUser.id,
        additionalFilters: {source: NURSE_SOURCES.HHA_EXCHANGE.value},
      });

      if (!isNurseLookupSuccessful) throw nurseLookupError;

      assertHhaManagedFieldsNotEdited({
        body: data,
        isHhaManaged: Boolean(hhaManagedNurseProfile),
        managedFields: HHA_MANAGED_NURSE_FIELDS,
      });
    }

    // Valid User model fields that can be updated
    const {UPDATABLE_USER_FIELDS} = usersConstants;

    // Filter out invalid fields - only keep valid User model fields
    // NON_UPDATABLE_USER_FIELDS (isVerified, isDeleted, secretKeys, otps) are automatically excluded
    const updateData = {};
    UPDATABLE_USER_FIELDS.forEach((field) => {
      if (field in data && field !== 'secretKeys') {
        updateData[field] = data[field];
      }
    });

    // Name, phone and address belong to the organization the person is in now;
    // only email, password and language are the account's.
    const membershipData = userUtils.pickMembershipDetails({data: updateData});

    const accountData = Object.fromEntries(
      Object.entries(updateData).filter(([field]) => !(field in membershipData))
    );

    const {error: updatingUserErr} = await UsersServices.updateOne({
      id: loggedInUser.id,
      data: accountData,
    });

    if (isDocumentDuplicationError({error: updatingUserErr})) {
      throw UsersErrorsFactories.userAlreadyRegisteredErr();
    }

    if (updatingUserErr) throw updatingUserErr;

    if (Object.keys(membershipData).length > 0) {
      const {error: updatingMembershipErr} =
        await UsersServices.updateMembershipDetails({
          userId: loggedInUser.id,
          organizationId: loggedInUser.currentActiveOrganization.organizationId,
          data: membershipData,
        });

      if (updatingMembershipErr) throw updatingMembershipErr;
    }

    // Logout from all devices: delete every OTHER session for this user.
    // The current session (making this very request) is deliberately kept
    // alive — this matches the pre-existing behavior where rotating the
    // shared secret invalidated other devices' tokens while the caller's
    // own token was immediately re-signed by refreshTokenMiddleware.
    // Runs AFTER the update succeeds, so a failed profile update (e.g. a
    // duplicate email) never logs out other devices for a request that
    // didn't actually go through.
    if (data.isLogoutFromAllDevices) {
      const {error: deleteOtherSessionsErr} =
        await SessionsServices.deleteOtherSessionsForUser({
          userId: loggedInUser.id,
          currentSessionId: req.extra.entities.session.id,
        });

      if (deleteOtherSessionsErr) throw deleteOtherSessionsErr;
    }

    req.extra.flags.needsToFetchUserInRefreshTokenMiddleware = true;

    return UsersResponsesFactories.profileUpdatedSuccessfully();
  }

  /**
   * Unified Users & Roles roster.
   *
   * Replaces the old generic findAll dump: one page spanning nurses,
   * caregivers and case managers, filtered and paginated in SQL because the
   * tabs and pager have to agree across roles.
   */
  static async listOrgUsers(req, res, next) {
    const {page, limit, skip, search, sortBy, sortDir} = getListParams({req});

    const {status, regionId, role, source, invitationStatus, archiveFilter} =
      req.query;

    const {role: callerRole, organizationId} =
      req.extra.jwtToken.user.currentActiveOrganization;

    const viewableRoles = usersConstants.ROSTER_ROLES.filter((rosterRole) => {
      const {hasStaticAccess} = checkStaticPermissions({
        entityToCheck: ROSTER_ROLE_ACL_ENTITIES[rosterRole],
        permissionKey: CRUD_PERMISSIONS.VIEW,
        role: callerRole,
      });

      return hasStaticAccess;
    });

    // A role filter can only narrow what the caller may already see.
    const roles = role
      ? viewableRoles.filter((viewable) => viewable === role)
      : viewableRoles;

    // users.view is a custom permission, so the ACL layer may have restricted
    // the caller to specific users. The roster is keyed on UserOrganization, so
    // that restriction has to be re-applied against userId rather than id.
    //
    // An EMPTY array means "no id restriction" (the default admin permission
    // is users.view: []), not "restrict to nothing" -- treating it as a filter
    // returns an empty roster to every admin.
    const allowedResourceIds = req.extra?.queries?.allowedResourceIds;

    const restrictedUserIds = allowedResourceIds?.length
      ? allowedResourceIds
      : null;

    const orderBy = buildOrderByClause({
      sortBy,
      sortDir,
      sortFields: usersConstants.USERS_SORT_FIELDS,
    });

    // Needed for every page, filtered or not: each row's invitation status
    // depends on whether the person has an open email exception.
    const conflictUserIds = Array.from(
      await loadEmailConflictUserIds({organizationId})
    );

    const filters = {
      roles,
      status,
      sources: source,
      regionId,
      search,
      restrictedUserIds,
      organizationId,
      invitationStatus,
      conflictUserIds,
      archiveFilter,
    };

    const [listResult, countsResult] = await Promise.all([
      UsersServices.listOrgUsers(
        safeMerge({
          originalObj: filters,
          newObj: {skip, take: limit, sort: orderBy},
        })
      ),

      // Tab counts deliberately ignore the role filter so the tabs keep their
      // totals while one role is selected.
      UsersServices.getRosterTabCounts(
        safeMerge({originalObj: filters, newObj: {viewableRoles}})
      ),
    ]);

    const {success, docs: memberships, error, count} = listResult;

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch users',
      });
    }

    // Empty tab counts on a 200 would read as "no users in any role".
    if (!countsResult.success || countsResult.error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch user counts',
      });
    }

    return UsersResponsesFactories.usersListRetrieved({
      memberships,
      conflictUserIds,
      tabCounts: countsResult.tabCounts,
      meta: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        count,
        totalPages: Math.ceil(count / limit),
      },
    });
  }

  static async getAdminStats(req, res, next) {
    const token = req.extra.jwtToken;
    const organizationId = token.user.currentActiveOrganization.organizationId;
    const {from, to} = req.query;

    const {
      success,
      doc: stats,
      error,
    } = await UsersServices.getAdminStats({
      organizationId,
      from,
      to,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to retrieve admin stats',
      });
    }

    return UsersResponsesFactories.adminStatsRetrieved({stats});
  }

  static async getAdminStatsTrends(req, res, next) {
    const token = req.extra.jwtToken;
    const organizationId = token.user.currentActiveOrganization.organizationId;
    const {from, to} = req.query;
    const scope = toReportScope({query: req.query});

    const timeZone = await OrganizationsServices.getOrganizationTimeZone({
      id: organizationId,
    });

    const {
      success,
      doc: trends,
      error,
    } = await UsersServices.getAdminStatsTrends({
      organizationId,
      timeZone,
      from,
      to,
      scope,
    });

    if (!success || error)
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to retrieve admin stats trends',
      });

    return UsersResponsesFactories.adminStatsTrendsRetrieved({trends});
  }

  static async uploadProfileImage(req, res, next) {
    const userId = req.extra.jwtToken.user.id;
    const file = req.file;

    const {success, user, error} = await UsersServices.getUserById({
      id: userId,
    });

    if (!success) throw error;
    if (!user) throw UsersErrorsFactories.userNotFoundErr();

    if (user.profileImage) {
      throw UsersErrorsFactories.profileImageAlreadyExistsErr();
    }

    const profileImage = await uploadProfileImage({file, userId});

    const {success: updateSuccess, error: updateError} =
      await UsersServices.updateOne({id: userId, data: {profileImage}});

    if (!updateSuccess) {
      cleanupProfileImage({key: profileImage.key});
      throw updateError || GeneralErrorsFactories.internalErr();
    }

    return UsersResponsesFactories.profileImageUploaded();
  }

  static async updateProfileImage(req, res, next) {
    const userId = req.extra.jwtToken.user.id;
    const file = req.file;

    const {success, user, error} = await UsersServices.getUserById({
      id: userId,
    });

    if (!success) throw error;
    if (!user) throw UsersErrorsFactories.userNotFoundErr();

    const previousProfileImage = user.profileImage;
    const profileImage = await uploadProfileImage({file, userId});

    const {success: updateSuccess, error: updateError} =
      await UsersServices.updateOne({id: userId, data: {profileImage}});

    if (!updateSuccess) {
      cleanupProfileImage({key: profileImage.key});
      throw updateError || GeneralErrorsFactories.internalErr();
    }

    if (previousProfileImage) {
      cleanupProfileImage({key: previousProfileImage.key});
    }

    return UsersResponsesFactories.profileImageUpdated();
  }

  static async deleteProfileImage(req, res, next) {
    const userId = req.extra.jwtToken.user.id;

    const {success, user, error} = await UsersServices.getUserById({
      id: userId,
    });

    if (!success) throw error;
    if (!user) throw UsersErrorsFactories.userNotFoundErr();

    if (!user.profileImage) {
      throw UsersErrorsFactories.profileImageNotFoundErr();
    }

    const {success: updateSuccess, error: updateError} =
      await UsersServices.updateOne({id: userId, data: {profileImage: null}});

    if (!updateSuccess)
      throw updateError || GeneralErrorsFactories.internalErr();

    cleanupProfileImage({key: user.profileImage.key});

    return UsersResponsesFactories.profileImageDeleted();
  }
};
