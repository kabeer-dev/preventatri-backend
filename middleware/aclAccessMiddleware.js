const {modelConstants} = require('../constants');
const {AuthErrorsFactories, GeneralErrorsFactories} = require('../factories');
const {GeneralServices} = require('../services');
const {aclUtils} = require('../utils');

/**
 * ACL (Access Control List) middleware for checking user permissions
 * Validates both static role-based permissions and dynamic resource-level permissions
 *
 * @param {Object} config - Configuration object for the middleware
 * @param {string} config.permissionKey - The permission action to check (e.g., 'view', 'create', 'update', 'delete')
 * @param {string} config.entityToCheck - The entity type to check permissions for (e.g., 'users', 'entities')
 * @param {Function|undefined} config.resourcesIdsValueORFunction - Optional function to extract resource IDs from request, or undefined for collection requests
 * @param {boolean} [config.isAdminAction=false] - If true, skips organization-level query filtering for admin operations
 *
 * @returns {Function} Express middleware function
 *
 * @throws {Error} Throws unauthorized error if user lacks required permissions
 * @throws {Error} Throws bad request error if permission does not exist
 * @throws {Error} Throws internal error for unexpected failures
 *
 * @example
 * // Static permission check only
 * router.get('/users', aclAccessMiddleware({
 *   permissionKey: 'view',
 *   entityToCheck: 'users'
 * }), usersController.getAll);
 *
 * @example
 * // With resource ID extraction for specific resource
 * router.patch('/users/:id', aclAccessMiddleware({
 *   permissionKey: 'update',
 *   entityToCheck: 'users',
 *   resourcesIdsValueORFunction: ({req}) => [req.params.id]
 * }), usersController.update);
 *
 * @example
 * // Admin action without organization filtering
 * router.get('/admin/users', aclAccessMiddleware({
 *   permissionKey: 'view',
 *   entityToCheck: 'users',
 *   isAdminAction: true
 * }), usersController.getAll);
 */
module.exports =
  ({
    permissionKey,
    entityToCheck,
    resourcesIdsValueORFunction,
    isAdminAction = false,
  }) =>
  async (req, _, next) => {
    try {
      const resourcesIds = aclUtils.extractResourcesIds({
        resourcesIdsValueORFunction,
        req,
      });

      const userId = req.extra.jwtToken.user.id;

      const {role, organizationId} =
        req.extra.jwtToken.user.currentActiveOrganization;

      if (!isAdminAction)
        req.extra.queries = aclUtils.buildOrganizationQuery({
          entityToCheck,
          organizationId,
          originalExtraQuery: req.extra.queries,
        });

      const {
        isCustomPermissions,
        hasStaticAccess,
        entityPermissionDoesNotExists,
      } = aclUtils.checkStaticPermissions({
        entityToCheck,
        permissionKey,
        role,
      }); // Check if the user has static access to the entity (check permissions from the ACL constants)

      if (entityPermissionDoesNotExists)
        throw GeneralErrorsFactories.badRequestErr({
          customMessage: 'Permission does not exist',
        });

      if (!hasStaticAccess) throw AuthErrorsFactories.unauthorized();

      if (!isCustomPermissions) {
        // If is not custom permission, then the user have access by default, but if they provide resourcesIds, then we need to restrict their action to only those provided ids.
        if (resourcesIds)
          req.extra.queries = aclUtils.buildIdExtraQuery({
            restrictedEntitiesIds: resourcesIds,
            originalExtraQuery: req.extra.queries,
          });

        return next();
      }

      const {doc: permissions, error} = await GeneralServices.findOne({
        model: modelConstants.MODELS.PERMISSION,
        query: {userId, organizationId},
        options: {bypassExtraQueries: true},
      });

      if (error) throw error;

      if (!permissions) throw AuthErrorsFactories.unauthorized();

      const {hasDynamicAccess, restrictedEntitiesIds} =
        aclUtils.checkDynamicPermissions({
          permissions,
          entityToCheck,
          permissionKey,
          resourcesIds,
        }); // Check if the user has dynamic access to the entity (check permissions from the permissions model)

      if (!hasDynamicAccess) throw AuthErrorsFactories.unauthorized();

      // Add IDs to request for controller filtering
      if (restrictedEntitiesIds)
        req.extra.queries = aclUtils.buildIdExtraQuery({
          restrictedEntitiesIds,
          originalExtraQuery: req.extra.queries,
        });

      next();
    } catch (error) {
      next(error);
    }
  };
