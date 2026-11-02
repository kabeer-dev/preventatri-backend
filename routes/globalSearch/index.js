const {Router} = require('express');

const {
  SYSTEM_ENTITIES,
  CRUD_PERMISSIONS,
} = require('../../constants/aclConstants');

const {GlobalSearchController} = require('../../controllers');

const {
  validatorMiddleware,
  catchAsyncMiddleware,
  aclAccessMiddleware,
} = require('../../middleware');

const {globalSearchSchema} = require('../../schemas');

const router = Router();

const GLOBAL_SEARCH_ENTITY = SYSTEM_ENTITIES.globalSearch.value;

// 📖 Search patients and staff by name (staff also by email)
// GET /search
// Access: Admins only. Scoped to the caller's active organization.
router.get(
  '/',

  // Authorize before validating so a non-admin gets 403, not a 400 describing the query rules.
  aclAccessMiddleware({
    entityToCheck: GLOBAL_SEARCH_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  validatorMiddleware({
    validateFunction: globalSearchSchema.validateGlobalSearchQuery,
    reqProperty: 'query',
  }),
  catchAsyncMiddleware(GlobalSearchController.searchAll)
);

module.exports = router;
