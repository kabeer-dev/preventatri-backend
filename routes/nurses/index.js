const {Router} = require('express');

const {
  SYSTEM_ENTITIES,
  CRUD_PERMISSIONS,
  NURSE_PERMISSIONS,
} = require('../../constants/aclConstants');
const {NursesController} = require('../../controllers');

const {
  validatorMiddleware,
  catchAsyncMiddleware,
  aclAccessMiddleware,
} = require('../../middleware');
const {nursesSchema} = require('../../schemas');

const router = Router();

/**
 * Entity constant for nurse-specific ACL checks
 * Nurses are a distinct entity type with granular permissions (view, update, delete)
 * This allows separate permission control from general user management
 */
const NURSE_ENTITY = SYSTEM_ENTITIES.nurse.value;

/**
 * 📋 Nurses CRUD Routes
 * All routes require authentication and organization context
 */

// 📖 List nurses in organization
// GET /nurses
// Access: Admins and users with nurse.view permission
router.get(
  '/',
  validatorMiddleware({
    validateFunction: nursesSchema.validateListNursesQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: NURSE_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(NursesController.listNurses)
);

// 📊 Get the dashboard for the logged-in nurse
// GET /nurses/dashboard
// Access: Nurses only (nurse.viewDashboard permission) — scoped to the patients
// in the caller's regions.
router.get(
  '/dashboard',
  aclAccessMiddleware({
    entityToCheck: NURSE_ENTITY,
    permissionKey: NURSE_PERMISSIONS.VIEW_DASHBOARD,
  }),
  catchAsyncMiddleware(NursesController.getNurseDashboard)
);

// 📊 Get org-wide nurse stats for the admin dashboard
// GET /nurses/admin/stats
// Access: Admins only (nurse.viewAdminStats permission) — total nurses,
// average alerts per nurse, and available (ACTIVE) nurses; optional from/to
// window on createdAt, all time by default.
router.get(
  '/admin/stats',
  validatorMiddleware({
    validateFunction: nursesSchema.validateNurseAdminStatsQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: NURSE_ENTITY,
    permissionKey: NURSE_PERMISSIONS.VIEW_ADMIN_STATS,
  }),
  catchAsyncMiddleware(NursesController.getNurseAdminStats)
);

// 📊 Get nurse profile details
// GET /nurses/:id
// Access: Authenticated users (can only view their own or admin can view any)
router.get(
  '/:id',
  validatorMiddleware({
    validateFunction: nursesSchema.validateNurseIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: NURSE_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(NursesController.getNurse)
);

// 🔄 Update nurse profile
// PATCH /nurses/:id
// Access: Admins only (nurse.update permission)
router.patch(
  '/:id',
  validatorMiddleware({
    validateFunction: nursesSchema.validateNurseIdParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: nursesSchema.validateNurseProfileUpdateRequest,
  }),
  aclAccessMiddleware({
    entityToCheck: NURSE_ENTITY,
    permissionKey: CRUD_PERMISSIONS.UPDATE,
  }),
  catchAsyncMiddleware(NursesController.updateNurse)
);

// 🗑️ Delete nurse (soft delete)
// DELETE /nurses/:id
// Access: Admins only (nurse.delete permission)
router.delete(
  '/:id',
  validatorMiddleware({
    validateFunction: nursesSchema.validateNurseIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: NURSE_ENTITY,
    permissionKey: CRUD_PERMISSIONS.DELETE,
  }),
  catchAsyncMiddleware(NursesController.deleteNurse)
);

module.exports = router;
