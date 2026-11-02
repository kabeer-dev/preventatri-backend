/**
 * Permission Structure Constants
 * Defines the shape and structure of permissions for each entity type
 * Used for validation, initialization, and consistency across permission operations
 */

/**
 * Per-entity permission shapes for initialization and validation
 * Each entity type has specific permission keys it supports.
 * IMPORTANT: Only includes permissions marked as isCustom: true in ACL_ACTIONS.
 * This prevents permission creep and maintains a clean permission model.
 *
 * Permission scope:
 * - users: view (custom), update (custom)
 * - region: view, update
 * - nurse: view (custom), update (custom)
 *
 * Standard CRUD (create, delete) are NOT tracked in permissions
 * as they're handled by role-based ACL checks directly.
 */
const ENTITY_PERMISSION_SHAPES = {
  users: {view: [], update: []},
  region: {view: [], update: []},
  nurse: {view: [], update: []},
  caregiver: {view: [], update: []},
  patient: {view: [], update: []},
  caseManager: {view: [], update: []},
};

/**
 * Allowed entities for permission management
 * Used to validate and whitelist entityToUpdate parameter
 * Prevents typos (e.g., "nurses" instead of "nurse") from corrupting permission structure
 * Derived from ENTITY_PERMISSION_SHAPES keys to maintain single source of truth
 */
const ALLOWED_ENTITIES = Object.keys(ENTITY_PERMISSION_SHAPES);

/**
 * Default permission overrides for each role
 * Maps roles to their permission configurations on creation
 * Roles not listed here default to empty permissions (no access)
 *
 * - Admin: Full access to users, regions, nurses, caregivers, patients, and case managers
 * - Nurse, Employee, Unknown: Minimal/no access (empty arrays)
 *
 * Only custom permissions (marked isCustom: true in ACL_ACTIONS) are set here.
 * Standard CRUD (create, delete) are enforced via role-based ACL checks.
 */
const DEFAULT_ROLE_PERMISSIONS = {
  admin: {
    region: {view: 'ALL', update: 'ALL'},
    nurse: {view: 'ALL', update: 'ALL'},
    caregiver: {view: 'ALL', update: 'ALL'},
    patient: {view: 'ALL', update: 'ALL'},
    caseManager: {view: 'ALL', update: 'ALL'},
  },

  case_manager: {
    caregiver: {view: 'ALL', update: 'ALL'},
    patient: {view: 'ALL', update: 'ALL'},
    region: {view: 'ALL', update: []},
  },

  // Nurse, employee, caregiver roles use empty permissions by default
  // (permissions are managed via ENTITY_PERMISSION_SHAPES which initializes all to [])
};

module.exports = {
  ENTITY_PERMISSION_SHAPES,
  ALLOWED_ENTITIES,
  DEFAULT_ROLE_PERMISSIONS,
};
