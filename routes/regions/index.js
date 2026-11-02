const {Router} = require('express');

const {
  SYSTEM_ENTITIES,
  CRUD_PERMISSIONS,
} = require('../../constants/aclConstants');
const {RegionsController} = require('../../controllers');

const {
  validatorMiddleware,
  catchAsyncMiddleware,
  aclAccessMiddleware,
} = require('../../middleware');
const regionsSchema = require('../../schemas/regionsSchema');

const router = Router();

/**
 * Entity constant for region-specific ACL checks
 */
const REGION_ENTITY = SYSTEM_ENTITIES.region.value;

/**
 * 🗺️ Regions CRUD Routes
 * All routes require authentication and organization context
 */

// 📖 List regions in organization
// GET /regions
// Access: Authenticated users
router.get(
  '/',
  validatorMiddleware({
    validateFunction: regionsSchema.validateListRegionsQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: REGION_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(RegionsController.listRegions)
);

// 📊 Get regions summary with nurse counts
// GET /regions/summary
// Access: Admins only
router.get(
  '/summary',
  aclAccessMiddleware({
    entityToCheck: REGION_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(RegionsController.getRegionsSummary)
);

// 👥 Get nurses in a region
// GET /regions/:id/nurses
// Access: Admins only
router.get(
  '/:id/nurses',
  validatorMiddleware({
    validateFunction: regionsSchema.validateRegionIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: REGION_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(RegionsController.getRegionNurses)
);

// 📖 Get single region
// GET /regions/:id
// Access: Authenticated users
router.get(
  '/:id',
  validatorMiddleware({
    validateFunction: regionsSchema.validateRegionIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: REGION_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(RegionsController.getRegion)
);

// ➕ Create a new region
// POST /regions
// Access: Admins only
router.post(
  '/',
  validatorMiddleware({
    validateFunction: regionsSchema.validateCreateRegionRequest,
  }),
  aclAccessMiddleware({
    entityToCheck: REGION_ENTITY,
    permissionKey: CRUD_PERMISSIONS.CREATE,
  }),
  catchAsyncMiddleware(RegionsController.createRegion)
);

// 🔄 Update region
// PATCH /regions/:id
// Access: Admins only
router.patch(
  '/:id',
  validatorMiddleware({
    validateFunction: regionsSchema.validateRegionIdParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: regionsSchema.validateUpdateRegionRequest,
  }),
  aclAccessMiddleware({
    entityToCheck: REGION_ENTITY,
    permissionKey: CRUD_PERMISSIONS.UPDATE,
  }),
  catchAsyncMiddleware(RegionsController.updateRegion)
);

// 🗑️ Delete region (soft delete)
// DELETE /regions/:id
// Access: Admins only
router.delete(
  '/:id',
  validatorMiddleware({
    validateFunction: regionsSchema.validateRegionIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: REGION_ENTITY,
    permissionKey: CRUD_PERMISSIONS.DELETE,
  }),
  catchAsyncMiddleware(RegionsController.deleteRegion)
);

module.exports = router;
