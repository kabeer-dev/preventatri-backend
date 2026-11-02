const {Router} = require('express');

const {SuperAdminController} = require('../../controllers');

const {validatorMiddleware, catchAsyncMiddleware} = require('../../middleware');
const superAdminSchema = require('../../schemas/superAdminSchema');

const router = Router();

/**
 * 🛡️ Super admin routes
 * Mounted behind authMiddleware and superAdminMiddleware, so only the super
 * admin reaches them. No ACL entity applies: they manage organizations, never an
 * organization's own data.
 */

// 📖 List organizations with their status and founding admin
// GET /super-admin/organizations
router.get(
  '/organizations',
  validatorMiddleware({
    validateFunction: superAdminSchema.validateListOrganizationsQuery,
    reqProperty: 'query',
  }),
  catchAsyncMiddleware(SuperAdminController.listOrganizations)
);

// ✅ Approve a pending organization
// POST /super-admin/organizations/:id/approve
router.post(
  '/organizations/:id/approve',
  validatorMiddleware({
    validateFunction: superAdminSchema.validateOrganizationIdParams,
    reqProperty: 'params',
  }),
  catchAsyncMiddleware(SuperAdminController.approveOrganization)
);

// ⛔ Reject a pending organization
// POST /super-admin/organizations/:id/reject
router.post(
  '/organizations/:id/reject',
  validatorMiddleware({
    validateFunction: superAdminSchema.validateOrganizationIdParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: superAdminSchema.validateOrganizationDecisionBody,
    reqProperty: 'body',
  }),
  catchAsyncMiddleware(SuperAdminController.rejectOrganization)
);

// ⏸️ Suspend an active organization
// POST /super-admin/organizations/:id/suspend
router.post(
  '/organizations/:id/suspend',
  validatorMiddleware({
    validateFunction: superAdminSchema.validateOrganizationIdParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: superAdminSchema.validateOrganizationDecisionBody,
    reqProperty: 'body',
  }),
  catchAsyncMiddleware(SuperAdminController.suspendOrganization)
);

// ▶️ Reactivate a suspended organization
// POST /super-admin/organizations/:id/reactivate
router.post(
  '/organizations/:id/reactivate',
  validatorMiddleware({
    validateFunction: superAdminSchema.validateOrganizationIdParams,
    reqProperty: 'params',
  }),
  catchAsyncMiddleware(SuperAdminController.reactivateOrganization)
);

module.exports = router;
