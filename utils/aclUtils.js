const {safeMerge} = require('./general');
const {getExtraContext} = require('./requestContext');

const {modelConstants} = require('../constants');

const {ACCESS_LEVELS, ACL_ACTIONS} = require('../constants/aclConstants');

// Helper to merge ACL queries from context into options
function mergeContextQueries({options = {}}) {
  const {bypassExtraQueries, ...restOptions} = options;

  if (bypassExtraQueries)
    return Object.assign({bypassExtraQueries: true}, restOptions);

  const contextQueries = getExtraContext().queries || {};

  return safeMerge({
    originalObj: restOptions,
    newObj: {extraQueries: contextQueries},
  });
}

const checkDynamicPermissions = ({
  permissions,
  entityToCheck,
  permissionKey,
  resourcesIds,
}) => {
  // Get levels from the JSON structure in the permission object
  const levels = permissions?.levels || {};

  // Access the appropriate level object (users, nurse, region, etc.)
  const entityLevelObj = levels[entityToCheck];

  // CRITICAL: If entity level is not found (unsupported entity/permission combo), fail closed with no access
  if (!entityLevelObj) {
    return {hasDynamicAccess: false, restrictedEntitiesIds: null};
  }

  // Get the access array for the specific permission (view, update, etc.)
  const userAccessLevel = entityLevelObj[permissionKey] || [];

  // Case 1: empty access level
  // GET /users -> users.view = [] -> User allowed to view some users, but has no ids
  if (userAccessLevel?.length === 0)
    return {hasDynamicAccess: true, restrictedEntitiesIds: []};

  // Case 2: No access
  // GET /users -> users.view = ['NONE'] -> User not allowed to view any user
  if (userAccessLevel.includes(ACCESS_LEVELS.none))
    return {hasDynamicAccess: false, restrictedEntitiesIds: null};

  // Case 3: Full access
  // GET /users & resourcesIds = [a, b] -> users.view = ['ALL'] -> User allowed to view all users but this request is only for some
  if (userAccessLevel.includes(ACCESS_LEVELS.all))
    return {
      hasDynamicAccess: true,
      restrictedEntitiesIds: resourcesIds?.length ? resourcesIds : null,
    };

  // Case 4: Specific resource check
  // GET /users & resourcesIds = [a, b] -> users.view = [a, b, c, d] -> User allowed to view some users and only these can be accessed else if he try accessing [a, b, f] then should be rejected
  if (resourcesIds?.length > 0) {
    const allowed = resourcesIds.every((id) => userAccessLevel.includes(id));

    return {
      hasDynamicAccess: allowed,
      restrictedEntitiesIds: allowed ? resourcesIds : null,
    };
  }

  // Case 5: Collection request - return IDs for filtering
  // GET /users -> users.view = [a, b, c, d] -> User allowed to view some users and trying to get all, then they should get access to their 4 allowed ones and nothing else
  return {
    hasDynamicAccess: true,
    restrictedEntitiesIds: userAccessLevel,
  };
};

const checkStaticPermissions = ({entityToCheck, permissionKey, role}) => {
  const entityAcl = ACL_ACTIONS[entityToCheck][permissionKey]; // Get the ACL rule for the given entity and permission key e.g { allowedRoles: [ 'admin' ], isCustom: true }

  const hasStaticAccess = entityAcl?.allowedRoles.includes(role); // Check if the user's role is allowed for this permission

  const isCustomPermissions = !!entityAcl?.isCustom; // Determine if the permission requires custom access logic
  const entityPermissionDoesNotExists = !entityAcl; // Check if the entity permission does not exist

  return {isCustomPermissions, hasStaticAccess, entityPermissionDoesNotExists};
};

function buildIdExtraQuery({originalExtraQuery, restrictedEntitiesIds}) {
  return safeMerge({
    originalObj: originalExtraQuery,
    newObj: {allowedResourceIds: restrictedEntitiesIds},
  });
}

function buildOrganizationQuery({
  entityToCheck,
  organizationId,
  originalExtraQuery,
}) {
  return safeMerge({
    originalObj: originalExtraQuery,
    newObj: {
      organizationId,
      entityToCheck,
    },
  });
}

function attachExtraQueriesFromOptions({model, originalQuery, options}) {
  const mergedOptions = mergeContextQueries({options});

  const {extraQueries = {}} = mergedOptions;

  const {organizationId, allowedResourceIds, entityToCheck} = extraQueries;

  // Use centralized mapping from modelConstants
  const {ENTITY_TO_MODEL_MAP = {}} = modelConstants;

  // Determine if the model being queried matches the entityToCheck
  // Only apply ID filtering when querying the actual entity, not related/junction tables
  const normalizedEntity = entityToCheck ? entityToCheck.toLowerCase() : null;
  const normalizedModel = model.toLowerCase();

  const mappedEntity = normalizedEntity
    ? ENTITY_TO_MODEL_MAP[normalizedEntity] || normalizedEntity
    : null;

  const shouldFilterByRestrictedIds = mappedEntity
    ? normalizedModel === mappedEntity
    : true;

  const shouldApplyResourceFiltering =
    Array.isArray(allowedResourceIds) &&
    !originalQuery.id &&
    shouldFilterByRestrictedIds; // Only apply when querying the target entity

  const inIdsArrayQuery = shouldApplyResourceFiltering
    ? {id: {in: allowedResourceIds}}
    : {};

  const isUserModel = model === modelConstants.MODELS.USER;

  const organizationQuery = organizationId
    ? isUserModel
      ? {userOrganizations: {some: {organizationId}}}
      : {organizationId}
    : {};

  return safeMerge({
    originalObj: originalQuery,
    newObj: safeMerge({
      originalObj: organizationQuery,
      newObj: inIdsArrayQuery,
    }),
  });
}

function extractResourcesIds({resourcesIdsValueORFunction, req}) {
  if (typeof resourcesIdsValueORFunction === 'function') {
    return resourcesIdsValueORFunction({req});
  }

  // Uncomment this if you want to support string or array as resourcesIdsValueORFunction
  // if (typeof resourcesIdsValueORFunction === 'string') {
  //   return [resourcesIdsValueORFunction];
  // }

  // if (Array.isArray(resourcesIdsValueORFunction)) {
  //   return resourcesIdsValueORFunction;
  // }

  if (req.params?.id) {
    return [req.params.id];
  }
}

module.exports = {
  checkDynamicPermissions,
  checkStaticPermissions,
  buildIdExtraQuery,
  buildOrganizationQuery,
  attachExtraQueriesFromOptions,
  extractResourcesIds,
  mergeContextQueries,
};
