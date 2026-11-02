const {Router} = require('express');

const {
  SYSTEM_ENTITIES,
  CRUD_PERMISSIONS,
} = require('../../constants/aclConstants');
const {CountiesController} = require('../../controllers');

const {
  validatorMiddleware,
  catchAsyncMiddleware,
  aclAccessMiddleware,
} = require('../../middleware');
const countiesSchema = require('../../schemas/countiesSchema');

const router = Router();

/**
 * Entity constant for county-specific ACL checks
 * Counties are managed through regions, so use region entity for ACL
 */
const COUNTY_ENTITY = SYSTEM_ENTITIES.region.value;

/**
 * 🏘️ Counties CRUD Routes (READ-ONLY)
 * All county <-> region assignments are managed through Region endpoints
 * Counties are immutable once created
 */

// 📖 List all counties in organization
// GET /counties
// Supports query: isActive, regionId, sortBy, sortDir, page, limit
// Access: Users with region.view permission
router.get(
  '/',
  validatorMiddleware({
    validateFunction: countiesSchema.validateListCountiesQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: COUNTY_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(CountiesController.listCounties)
);

// 🇺🇸 List US counties available to add to a region
// GET /counties/reference
// Supports query: search, stateCode, page, limit
// Access: Users with region.view permission
router.get(
  '/reference',
  validatorMiddleware({
    validateFunction: countiesSchema.validateListReferenceCountiesQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: COUNTY_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(CountiesController.listReferenceCounties)
);

// 🗺️ Get counties by region
// GET /counties/regions/:regionId
// Access: Users with region.view permission
router.get(
  '/regions/:regionId',
  validatorMiddleware({
    validateFunction: countiesSchema.validateRegionIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: COUNTY_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(CountiesController.getCountiesByRegion)
);

// 📖 Get single county
// GET /counties/:id
// Access: Users with region.view permission
router.get(
  '/:id',
  validatorMiddleware({
    validateFunction: countiesSchema.validateCountyIdParams,
    reqProperty: 'params',
  }),
  aclAccessMiddleware({
    entityToCheck: COUNTY_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(CountiesController.getCounty)
);

module.exports = router;
