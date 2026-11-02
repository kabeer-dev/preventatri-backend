const express = require('express');

const {
  accessConstants: {
    SYSTEM_ENTITIES,
    CRUD_PERMISSIONS,
    INVITE_PERMISSIONS,
    USER_PERMISSIONS,
  },
} = require('../../constants');

const {
  ALLOWED_PROFILE_IMAGE_TYPES,
  PROFILE_IMAGE_MAX_SIZE_BYTES,
} = require('../../constants/file');
const {UsersController} = require('../../controllers');

const {
  validatorMiddleware,
  authMiddleware,
  aclAccessMiddleware,
  catchAsyncMiddleware,
  otpFlowMiddleware,
  fileUploadMiddleware,
} = require('../../middleware');
const {usersSchema} = require('../../schemas');
const {dynamicRoutesMiddlewareChecker} = require('../../utils/expressUtils');

const router = express.Router();

/**
 * Entity constant for user-specific ACL checks
 */
const USERS_ENTITY = SYSTEM_ENTITIES.users.value;

// Unified Users & Roles roster: nurses, caregivers and case managers in one
// filtered, sorted, paginated list. Admins hold no role profile and are
// deliberately not listed.
router.get(
  '/',
  authMiddleware,
  validatorMiddleware({
    validateFunction: usersSchema.validateListUsersQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: USERS_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(UsersController.listOrgUsers)
);

router.get(
  '/me',
  authMiddleware,
  catchAsyncMiddleware(UsersController.getLoggedInUserInformation)
);

router.get(
  '/me/organizations',
  authMiddleware,
  catchAsyncMiddleware(UsersController.getMyOrganizations)
);

// Access: Admins only (users.viewAdminStats permission). Static role check —
// not tied to the custom users.view permission overrides, so every admin can
// load the dashboard stats regardless of their user-management restrictions.
router.get(
  '/admin/stats',
  authMiddleware,
  validatorMiddleware({
    validateFunction: usersSchema.validateAdminStatsQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: USERS_ENTITY,
    permissionKey: USER_PERMISSIONS.VIEW_ADMIN_STATS,
  }),
  catchAsyncMiddleware(UsersController.getAdminStats)
);

// Access: Admins only (users.viewAdminStats permission). Flags raised and SLA
// compliance per day for the dashboard Trends cards, windowable via from/to.
router.get(
  '/admin/stats/trends',
  authMiddleware,
  validatorMiddleware({
    validateFunction: usersSchema.validateAdminStatsTrendsQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: USERS_ENTITY,
    permissionKey: USER_PERMISSIONS.VIEW_ADMIN_STATS,
  }),
  catchAsyncMiddleware(UsersController.getAdminStatsTrends)
);

router.post(
  '/login',
  validatorMiddleware({
    validateFunction: usersSchema.validateLoginRequest,
    reqProperty: 'body',
  }),
  catchAsyncMiddleware(UsersController.loginUser),
  otpFlowMiddleware
);

router.post(
  '/otp/regenerate/public',
  validatorMiddleware({
    validateFunction: usersSchema.validateRegenerateOtpRequest,
    reqProperty: 'body',
  }),
  catchAsyncMiddleware(UsersController.regenerateOtp)
);

router.post(
  '/otp/regenerate/private',
  authMiddleware,
  validatorMiddleware({
    validateFunction: usersSchema.validateRegenerateOtpRequest,
    reqProperty: 'body',
  }),
  catchAsyncMiddleware(UsersController.regenerateOtp)
);

router.post(
  '/signup',
  validatorMiddleware({
    validateFunction: usersSchema.validateCreateRequest,
    reqProperty: 'body',
  }),
  catchAsyncMiddleware(UsersController.createUser)
);

router.post(
  '/forgot-password',
  validatorMiddleware({
    validateFunction: usersSchema.validateEmail,
    reqProperty: 'body',
  }),
  catchAsyncMiddleware(UsersController.forgetPassword)
);

// ✉️ Invite a nurse, caregiver or case manager
// POST /users/invite?userType=nurse|caregiver|case_manager
// Access: Admins only (users.inviteUser permission)
// The user type is validated first — the body schema and the controller are
// both selected from it.
router.post(
  '/invite',
  authMiddleware,
  validatorMiddleware({
    validateFunction: usersSchema.validateInviteUserTypeQuery,
    reqProperty: 'query',
  }),
  validatorMiddleware({
    validateFunction: usersSchema.validateInviteUserRequest,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: USERS_ENTITY,
    permissionKey: INVITE_PERMISSIONS.INVITE_USER,
  }),
  catchAsyncMiddleware(UsersController.inviteUser)
);

router.post('/logout', catchAsyncMiddleware(UsersController.logout));

router.post(
  '/switch-organization',
  authMiddleware,
  validatorMiddleware({
    validateFunction: usersSchema.validateSwitchOrganizationRequest,
    reqProperty: 'body',
  }),
  catchAsyncMiddleware(UsersController.switchOrganization)
);

router.post(
  '/unlock-account/send',
  validatorMiddleware({
    validateFunction: usersSchema.validateEmail,
    reqProperty: 'body',
  }),
  catchAsyncMiddleware(UsersController.sendUnlockEmail)
);

router.post(
  '/verify/refresh',
  validatorMiddleware({
    validateFunction: usersSchema.validateEmail,
    reqProperty: 'body',
  }),
  catchAsyncMiddleware(UsersController.regenerateVerifyToken)
);

router.post(
  '/invitation/resend',
  authMiddleware,
  validatorMiddleware({
    validateFunction: usersSchema.validateEmail,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: USERS_ENTITY,
    permissionKey: INVITE_PERMISSIONS.INVITE_USER,
  }),
  catchAsyncMiddleware(UsersController.resendInvitation)
);

router.post(
  '/invitation/bulk',
  authMiddleware,
  validatorMiddleware({
    validateFunction: usersSchema.validateBulkInvitationRequest,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: USERS_ENTITY,
    permissionKey: INVITE_PERMISSIONS.INVITE_USER,
  }),
  catchAsyncMiddleware(UsersController.bulkInvite)
);

router.post(
  '/invitation/revoke',
  authMiddleware,
  validatorMiddleware({
    validateFunction: usersSchema.validateRevokeInvitationRequest,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: USERS_ENTITY,
    permissionKey: INVITE_PERMISSIONS.INVITE_USER,
  }),
  catchAsyncMiddleware(UsersController.revokeInvitation)
);

router.post(
  '/profile-image',
  authMiddleware,
  fileUploadMiddleware({
    allowedTypes: ALLOWED_PROFILE_IMAGE_TYPES,
    fileSizeLimit: PROFILE_IMAGE_MAX_SIZE_BYTES,
    require: true,
  }),
  catchAsyncMiddleware(UsersController.uploadProfileImage)
);

router.post(
  '/unlock-account/:token',
  dynamicRoutesMiddlewareChecker(
    catchAsyncMiddleware(UsersController.unlockAccount)
  )
);

router.post(
  '/verify/:token',
  dynamicRoutesMiddlewareChecker(
    validatorMiddleware({
      validateFunction: usersSchema.validateVerifyInvitedUserRequest,
      reqProperty: 'body',
    })
  ),
  dynamicRoutesMiddlewareChecker(
    catchAsyncMiddleware(UsersController.verifyInvitedUser)
  )
);

// Access: public. The emailed link's secret proves it was sent to this person.
router.post(
  '/organization-invitations/:token/accept',
  dynamicRoutesMiddlewareChecker(
    validatorMiddleware({
      validateFunction: usersSchema.validateOrganizationInvitationTokenParams,
      reqProperty: 'params',
    })
  ),
  dynamicRoutesMiddlewareChecker(
    catchAsyncMiddleware(UsersController.acceptOrganizationInvitation)
  )
);

router.post(
  '/verify/new/:token',
  dynamicRoutesMiddlewareChecker(
    catchAsyncMiddleware(UsersController.verifyUser)
  )
);

router.put(
  '/profile-image',
  authMiddleware,
  fileUploadMiddleware({
    allowedTypes: ALLOWED_PROFILE_IMAGE_TYPES,
    fileSizeLimit: PROFILE_IMAGE_MAX_SIZE_BYTES,
    require: true,
  }),
  catchAsyncMiddleware(UsersController.updateProfileImage)
);

router.patch(
  '/profile',
  authMiddleware,
  validatorMiddleware({
    validateFunction: usersSchema.validateProfileUpdateRequest,
    reqProperty: 'body',
  }),
  otpFlowMiddleware,
  catchAsyncMiddleware(UsersController.updateProfile)
);

router.patch(
  '/language',
  authMiddleware,
  validatorMiddleware({
    validateFunction: usersSchema.validateLanguage,
    reqProperty: 'body',
  }),
  catchAsyncMiddleware(UsersController.updateUserLanguage)
);

router.patch(
  '/reset/:token',
  dynamicRoutesMiddlewareChecker(
    validatorMiddleware({
      validateFunction: usersSchema.validateResetPasswordRequest,
      reqProperty: 'body',
    })
  ),
  dynamicRoutesMiddlewareChecker(
    catchAsyncMiddleware(UsersController.resetPassword)
  )
);

router.delete(
  '/profile-image',
  authMiddleware,
  catchAsyncMiddleware(UsersController.deleteProfileImage)
);

router.delete(
  '/:id',
  dynamicRoutesMiddlewareChecker(authMiddleware),
  dynamicRoutesMiddlewareChecker(
    validatorMiddleware({
      validateFunction: usersSchema.validateUserIdParams,
      reqProperty: 'params',
    })
  ),
  dynamicRoutesMiddlewareChecker(
    aclAccessMiddleware({
      entityToCheck: USERS_ENTITY,
      permissionKey: CRUD_PERMISSIONS.DELETE,
    })
  ),
  dynamicRoutesMiddlewareChecker(
    catchAsyncMiddleware(UsersController.deleteUser)
  )
);

module.exports = router;
