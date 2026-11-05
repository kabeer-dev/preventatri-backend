const {Router} = require('express');

const {
  SYSTEM_ENTITIES,
  CRUD_PERMISSIONS,
} = require('../../constants/aclConstants');
const {OrganizationsController} = require('../../controllers');

const {
  validatorMiddleware,
  catchAsyncMiddleware,
  aclAccessMiddleware,
} = require('../../middleware');
const organizationsSchema = require('../../schemas/organizationsSchema');

const router = Router();

/**
 * Entity constant for organization-specific ACL checks
 */
const ORGANIZATION_ENTITY = SYSTEM_ENTITIES.organization.value;

/**
 * 🏢 Organizations Routes
 * All routes require authentication. There is no :id param — every route
 * operates on the caller's own organization (from the JWT's
 * currentActiveOrganization), and isAdminAction skips the ACL layer's
 * auto org-scoping since Organization has no organizationId column (it IS
 * the org) — the controller/service scope by {id: organizationId} instead.
 */

// 📖 Get current organization's working hours
// GET /organizations/working-hours
// Access: Admin, Nurse, Case Manager
router.get(
  '/working-hours',
  aclAccessMiddleware({
    entityToCheck: ORGANIZATION_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
    isAdminAction: true,
  }),
  catchAsyncMiddleware(OrganizationsController.getWorkingHours)
);

// 🔄 Update current organization's working hours
// PATCH /organizations/working-hours
// Access: Admins only
router.patch(
  '/working-hours',
  validatorMiddleware({
    validateFunction: organizationsSchema.validateUpdateWorkingHoursRequest,
  }),
  aclAccessMiddleware({
    entityToCheck: ORGANIZATION_ENTITY,
    permissionKey: CRUD_PERMISSIONS.UPDATE,
    isAdminAction: true,
  }),
  catchAsyncMiddleware(OrganizationsController.updateWorkingHours)
);

// 📖 Get current organization's time zone
// GET /organizations/time-zone
// Access: Admin, Nurse, Case Manager
router.get(
  '/time-zone',
  aclAccessMiddleware({
    entityToCheck: ORGANIZATION_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
    isAdminAction: true,
  }),
  catchAsyncMiddleware(OrganizationsController.getTimeZone)
);

// 🔄 Update current organization's time zone
// PATCH /organizations/time-zone
// Access: Admins only
router.patch(
  '/time-zone',
  validatorMiddleware({
    validateFunction: organizationsSchema.validateUpdateTimeZoneRequest,
  }),
  aclAccessMiddleware({
    entityToCheck: ORGANIZATION_ENTITY,
    permissionKey: CRUD_PERMISSIONS.UPDATE,
    isAdminAction: true,
  }),
  catchAsyncMiddleware(OrganizationsController.updateTimeZone)
);

// 📖 Whether the current organization is connected to HHAeXchange
// GET /organizations/hha-credentials
// Access: Admins only. The secret and key are never returned.
router.get(
  '/hha-credentials',
  aclAccessMiddleware({
    entityToCheck: ORGANIZATION_ENTITY,
    permissionKey: CRUD_PERMISSIONS.UPDATE,
    isAdminAction: true,
  }),
  catchAsyncMiddleware(OrganizationsController.getHhaCredentials)
);

// 🔄 Connect the current organization to HHAeXchange
// PUT /organizations/hha-credentials
// Access: Admins only. HHAeXchange must accept the credentials before they are saved.
router.put(
  '/hha-credentials',
  validatorMiddleware({
    validateFunction: organizationsSchema.validateSaveHhaCredentialsRequest,
  }),
  aclAccessMiddleware({
    entityToCheck: ORGANIZATION_ENTITY,
    permissionKey: CRUD_PERMISSIONS.UPDATE,
    isAdminAction: true,
  }),
  catchAsyncMiddleware(OrganizationsController.saveHhaCredentials)
);

// 🗑️ Disconnect the current organization from HHAeXchange
// DELETE /organizations/hha-credentials
// Access: Admins only
router.delete(
  '/hha-credentials',
  aclAccessMiddleware({
    entityToCheck: ORGANIZATION_ENTITY,
    permissionKey: CRUD_PERMISSIONS.UPDATE,
    isAdminAction: true,
  }),
  catchAsyncMiddleware(OrganizationsController.disconnectHhaCredentials)
);

// 📖 Get current organization's RED and YELLOW escalation policies
// GET /organizations/escalation-policies
// Access: Admin, Nurse, Case Manager
router.get(
  '/escalation-policies',
  aclAccessMiddleware({
    entityToCheck: ORGANIZATION_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
    isAdminAction: true,
  }),
  catchAsyncMiddleware(OrganizationsController.getEscalationPolicies)
);

// 🔄 Update current organization's escalation policy for one flag color
// PUT /organizations/escalation-policies/:flag
// Access: Admins only
router.put(
  '/escalation-policies/:flag',
  validatorMiddleware({
    validateFunction: organizationsSchema.validateEscalationPolicyFlagParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: organizationsSchema.validateUpdateEscalationPolicyRequest,
  }),
  aclAccessMiddleware({
    entityToCheck: ORGANIZATION_ENTITY,
    permissionKey: CRUD_PERMISSIONS.UPDATE,
    isAdminAction: true,
  }),
  catchAsyncMiddleware(OrganizationsController.updateEscalationPolicy)
);

module.exports = router;
