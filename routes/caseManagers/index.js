const {Router} = require('express');

const {
  SYSTEM_ENTITIES,
  CRUD_PERMISSIONS,
  CASE_MANAGER_PERMISSIONS,
} = require('../../constants/aclConstants');
const {CaseManagersController} = require('../../controllers');

const {
  validatorMiddleware,
  catchAsyncMiddleware,
  aclAccessMiddleware,
} = require('../../middleware');
const {caseManagersSchema} = require('../../schemas');

const router = Router();

const CASE_MANAGER_ENTITY = SYSTEM_ENTITIES.caseManager.value;

/**
 * Case Managers CRUD Routes
 * All routes require authentication and organization context
 */

// 📖 List case managers in organization
// GET /case-managers
// Access: Admins with caseManager.view permission
router.get(
  '/',
  validatorMiddleware({
    validateFunction: caseManagersSchema.validateListCaseManagersQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: CASE_MANAGER_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(CaseManagersController.listCaseManagers)
);

// 🏥 Get patients available for case manager assignment
// GET /case-managers/available-patients
// Access: Admins only (caseManager.viewAvailablePatients permission)
router.get(
  '/available-patients',
  validatorMiddleware({
    validateFunction: caseManagersSchema.validateAvailablePatientsQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: CASE_MANAGER_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(CaseManagersController.getAvailablePatients)
);

// 📊 Get the dashboard for the logged-in case manager
// GET /case-managers/dashboard
// Access: Case managers only (caseManager.viewDashboard permission), scoped
// to the caller.
router.get(
  '/dashboard',
  aclAccessMiddleware({
    entityToCheck: CASE_MANAGER_ENTITY,
    permissionKey: CASE_MANAGER_PERMISSIONS.VIEW_DASHBOARD,
  }),
  catchAsyncMiddleware(CaseManagersController.getCaseManagerDashboard)
);

// 📊 Get org-wide case manager stats for the admin dashboard
// GET /case-managers/admin/stats
// Access: Admins only (caseManager.viewAdminStats permission) — total case
// managers, average cases per case manager, and active case managers;
// optional from/to window on createdAt, all time by default.
router.get(
  '/admin/stats',
  validatorMiddleware({
    validateFunction: caseManagersSchema.validateCaseManagerAdminStatsQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: CASE_MANAGER_ENTITY,
    permissionKey: CASE_MANAGER_PERMISSIONS.VIEW_ADMIN_STATS,
  }),
  catchAsyncMiddleware(CaseManagersController.getCaseManagerAdminStats)
);

// 📊 Get case manager profile details
// GET /case-managers/:id
// Access: Authenticated users with caseManager.view permission
router.get(
  '/:id',
  validatorMiddleware({
    validateFunction: caseManagersSchema.validateCaseManagerIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: CASE_MANAGER_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(CaseManagersController.getCaseManager)
);

// 🔄 Update case manager profile
// PATCH /case-managers/:id
// Access: Admins only (caseManager.update permission)
router.patch(
  '/:id',
  validatorMiddleware({
    validateFunction: caseManagersSchema.validateCaseManagerIdParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction:
      caseManagersSchema.validateCaseManagerProfileUpdateRequest,
  }),
  aclAccessMiddleware({
    entityToCheck: CASE_MANAGER_ENTITY,
    permissionKey: CRUD_PERMISSIONS.UPDATE,
  }),
  catchAsyncMiddleware(CaseManagersController.updateCaseManager)
);

// 🗑️ Delete case manager (soft delete)
// DELETE /case-managers/:id
// Access: Admins only (caseManager.delete permission)
router.delete(
  '/:id',
  validatorMiddleware({
    validateFunction: caseManagersSchema.validateCaseManagerIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: CASE_MANAGER_ENTITY,
    permissionKey: CRUD_PERMISSIONS.DELETE,
  }),
  catchAsyncMiddleware(CaseManagersController.deleteCaseManager)
);

module.exports = router;
