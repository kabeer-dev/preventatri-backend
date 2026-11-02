const {Router} = require('express');

const {
  SYSTEM_ENTITIES,
  CRUD_PERMISSIONS,
  CAREGIVER_PERMISSIONS,
} = require('../../constants/aclConstants');
const {CaregiversController} = require('../../controllers');

const {
  validatorMiddleware,
  catchAsyncMiddleware,
  aclAccessMiddleware,
} = require('../../middleware');
const {caregiversSchema} = require('../../schemas');

const router = Router();

const CAREGIVER_ENTITY = SYSTEM_ENTITIES.caregiver.value;

/**
 * Caregivers CRUD Routes
 * All routes require authentication and organization context
 */

// 📖 List caregivers in organization
// GET /caregivers
// Access: Admins and Case Managers with caregiver.view permission
router.get(
  '/',
  validatorMiddleware({
    validateFunction: caregiversSchema.validateListCaregiversQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: CAREGIVER_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(CaregiversController.listCaregivers)
);

// 📊 Get dashboard stats for the logged-in caregiver
// GET /caregivers/stats
// Self-scoped to the authenticated caller (their assigned patients, assessments
// due/completed, submitted flags and follow-up tasks); restricted to the
// caregiver role via the caregiver.viewStats permission. Accepts an optional
// from/to date range and defaults to all-time when omitted.
router.get(
  '/stats',
  validatorMiddleware({
    validateFunction: caregiversSchema.validateCaregiverStatsQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: CAREGIVER_ENTITY,
    permissionKey: CAREGIVER_PERMISSIONS.VIEW_STATS,
  }),
  catchAsyncMiddleware(CaregiversController.getCaregiverStats)
);

// 📊 Get org-wide caregiver stats for the admin dashboard
// GET /caregivers/admin/stats
// Access: Admins only (caregiver.viewAdminStats permission) — total, active
// and inactive caregiver counts; optional from/to window on createdAt, all
// time by default. Reuses the stats query validator (same from/to shape).
router.get(
  '/admin/stats',
  validatorMiddleware({
    validateFunction: caregiversSchema.validateCaregiverStatsQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: CAREGIVER_ENTITY,
    permissionKey: CAREGIVER_PERMISSIONS.VIEW_ADMIN_STATS,
  }),
  catchAsyncMiddleware(CaregiversController.getCaregiverAdminStats)
);

// 📈 Get caregiver statistics
// GET /caregivers/:id/statistics
// Access: Authenticated users with caregiver.view permission
router.get(
  '/:id/statistics',
  validatorMiddleware({
    validateFunction: caregiversSchema.validateCaregiverIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: CAREGIVER_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(CaregiversController.getCaregiverStatistics)
);

// 📊 Get caregiver profile details
// GET /caregivers/:id
// Access: Authenticated users with caregiver.view permission
router.get(
  '/:id',
  validatorMiddleware({
    validateFunction: caregiversSchema.validateCaregiverIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: CAREGIVER_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(CaregiversController.getCaregiver)
);

// 🔄 Update caregiver profile
// PATCH /caregivers/:id
// Access: Admins and Case Managers (caregiver.update permission)
router.patch(
  '/:id',
  validatorMiddleware({
    validateFunction: caregiversSchema.validateCaregiverIdParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: caregiversSchema.validateCaregiverProfileUpdateRequest,
  }),
  aclAccessMiddleware({
    entityToCheck: CAREGIVER_ENTITY,
    permissionKey: CRUD_PERMISSIONS.UPDATE,
  }),
  catchAsyncMiddleware(CaregiversController.updateCaregiver)
);

// 🗑️ Delete caregiver (soft delete)
// DELETE /caregivers/:id
// Access: Admins only (caregiver.delete permission)
router.delete(
  '/:id',
  validatorMiddleware({
    validateFunction: caregiversSchema.validateCaregiverIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: CAREGIVER_ENTITY,
    permissionKey: CRUD_PERMISSIONS.DELETE,
  }),
  catchAsyncMiddleware(CaregiversController.deleteCaregiver)
);

module.exports = router;
