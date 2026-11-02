/**
 * Permission Utility Functions
 * Handles permission operations, role-based configuration, and permission shape management
 *
 * ============================================================================
 * MODULE PURPOSE:
 * ============================================================================
 * This module provides utilities for creating and managing permission structures
 * across different roles and entities. It centralizes all role-based permission
 * defaults so they're defined in ONE place (constants/permissionConstants.js)
 * and reused everywhere, avoiding duplication and making maintenance easier.
 *
 * ============================================================================
 * HOW IT WORKS:
 * ============================================================================
 * 1. ENTITY_PERMISSION_SHAPES (from constants):
 *    - Defines the STRUCTURE (fields) each entity supports
 *    - Example: nurse has {inviteUser, view, update, delete, assignRegions}
 *    - Example: users has {view, update}
 *
 * 2. DEFAULT_ROLE_PERMISSIONS (from constants):
 *    - Defines what each role CAN DO (overrides)
 *    - Example: admin gets [ACCESS_LEVELS.all] for most entities
 *    - Example: nurse/employee get [] (empty, no access by default)
 *
 * 3. createDefaultLevels({roleValue}):
 *    - Creates initial permission levels for a user based on their role
 *    - Step 1: Initialize all entities with empty permissions (from shapes)
 *    - Step 2: Apply role-specific overrides (if any exist)
 *    - Returns: Complete permission structure ready to save to database
 *
 * ============================================================================
 * HOW TO ADD A NEW ROLE:
 * ============================================================================
 * 1. Add role to usersConstants.SYSTEM_ROLES (if not already there)
 * 2. Add role overrides to constants/permissionConstants.js DEFAULT_ROLE_PERMISSIONS:
 *
 *    const DEFAULT_ROLE_PERMISSIONS = {
 *      admin: { ... existing ... },
 *      newRole: {
 *        entities: {view: 'ALL'},
 *        region: {view: 'ALL'},
 *        // Other entities default to [] (from ENTITY_PERMISSION_SHAPES)
 *      },
 *    };
 *
 * 3. The utility will automatically handle it - no code changes needed here!
 *
 * ============================================================================
 * HOW TO ADD A NEW ENTITY TYPE:
 * ============================================================================
 * 1. Add entity to constants/aclConstants.js SYSTEM_ENTITIES
 * 2. Define its structure in constants/permissionConstants.js ENTITY_PERMISSION_SHAPES:
 *
 *    const ENTITY_PERMISSION_SHAPES = {
 *      newEntity: {field1: [], field2: [], ...},
 *      // Other entities...
 *    };
 *
 * 3. Optional: Add role overrides in DEFAULT_ROLE_PERMISSIONS if needed
 * 4. The utility will automatically initialize it for all roles!
 *
 * ============================================================================
 */

const {accessConstants, usersConstants} = require('../constants');

const {
  ENTITY_PERMISSION_SHAPES,
  DEFAULT_ROLE_PERMISSIONS,
} = require('../constants/permissionConstants');

/**
 * Creates initial permission levels structure with all entities initialized
 * Uses ENTITY_PERMISSION_SHAPES to ensure correct structure for each entity type
 *
 * @param {Object} param - Parameters object
 * @param {string} param.roleValue - The role value (admin, nurse, employee)
 * @returns {Object} Permission levels object with all entities initialized
 */
const createDefaultLevels = ({roleValue}) => {
  // Step 1: Initialize all entities with empty permissions (from ENTITY_PERMISSION_SHAPES)
  const levels = {};
  Object.entries(ENTITY_PERMISSION_SHAPES).forEach(([entity, shape]) => {
    // Deep copy to prevent reference mutations
    levels[entity] = JSON.parse(JSON.stringify(shape));
  });

  // Step 2: Get role-specific overrides (if any exist)
  const roleOverrides = DEFAULT_ROLE_PERMISSIONS[roleValue];

  // Step 3: Apply overrides by directly converting 'ALL' to actual access level
  if (roleOverrides) {
    Object.entries(roleOverrides).forEach(([entity, permissions]) => {
      if (levels[entity]) {
        Object.entries(permissions).forEach(([key, value]) => {
          // Replace 'ALL' string with actual constant, otherwise keep as-is
          levels[entity][key] =
            value === 'ALL' ? [accessConstants.ACCESS_LEVELS.all] : value;
        });
      }
    });
  }

  // Step 4: Special case - admin always gets full user access
  if (roleValue === usersConstants.SYSTEM_ROLES.admin.value) {
    levels.users.view = [accessConstants.ACCESS_LEVELS.all];
    levels.users.update = [accessConstants.ACCESS_LEVELS.all];
  }

  return levels;
};

module.exports = {
  createDefaultLevels,
};
