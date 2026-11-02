const {
  modelConstants,
  permissionConstants: {ENTITY_PERMISSION_SHAPES},
} = require('../constants');
const {PrismaFactory, GeneralErrorsFactories} = require('../factories');
const {safeMerge} = require('../utils');
const {createDefaultLevels} = require('../utils/permissionUtils');

module.exports = class PermissionsServices {
  static async updatePermissions({
    id,
    entityToUpdate,
    updatedValues,
    options,
    tx,
  }) {
    try {
      // Get current permission to merge with new values
      const currentPermission = await PrismaFactory.findById({
        model: modelConstants.MODELS.PERMISSION,
        id,
      });

      // FIX: Add error handling for failed permission fetch
      if (!currentPermission?.success || currentPermission?.error) {
        throw GeneralErrorsFactories.internalErr({
          customMessage:
            currentPermission?.error?.message || 'Permission not found',
        });
      }

      let levels =
        currentPermission?.doc?.levels ||
        safeMerge({
          originalObj: {},
          newObj: ENTITY_PERMISSION_SHAPES,
          deep: true,
        });

      // Ensure all required fields exist (handles legacy documents)
      const requiredFields = {
        users: true,
        region: true,
        nurse: true,
      };
      Object.keys(requiredFields).forEach((field) => {
        if (!levels[field]) {
          // Use safeMerge for deep copy to avoid reference sharing
          // Creates independent copy so modifying one role's permissions doesn't affect others
          levels[field] = safeMerge({
            originalObj: {},
            newObj: ENTITY_PERMISSION_SHAPES[field],
            deep: true,
          });
        }
      });

      // Defensive initialization: ensure entityToUpdate exists with correct shape
      // entityToUpdate is already validated above, so safe to use
      if (!levels[entityToUpdate]) {
        levels[entityToUpdate] = safeMerge({
          originalObj: {},
          newObj: ENTITY_PERMISSION_SHAPES[entityToUpdate],
          deep: true,
        });
      }

      // Merge updated values into the levels structure
      if (levels[entityToUpdate]) {
        Object.assign(levels[entityToUpdate], updatedValues);
      }

      const {success, doc, error} = await PrismaFactory.updateOne({
        model: modelConstants.MODELS.PERMISSION,
        query: {id},
        data: {levels},
        tx,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async createInitialPermissions({userId, organizationId, role, tx}) {
    try {
      // Create default permission levels based on role
      // This handles all role-specific permission assignments in one place
      const levels = createDefaultLevels({roleValue: role});

      const permissionData = {
        userId,
        organizationId,
        levels,
      };

      const {success, doc, error} = await PrismaFactory.create({
        model: modelConstants.MODELS.PERMISSION,
        data: permissionData,
        tx,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Reset permissions for a user in an organization based on a new role.
   * Used when a user's role changes (e.g., re-invited as a different role
   * or when a deleted profile is recreated). Replaces existing permission
   * levels with defaults for the new role.
   *
   * @param {Object} params - Parameters
   * @param {string} params.userId - User ID
   * @param {string} params.organizationId - Organization ID
   * @param {string} params.role - The new role to set permissions for
   * @param {Object} [params.tx] - Optional transaction context
   * @returns {Object} { success, doc, error }
   */
  static async resetPermissionsForRole({userId, organizationId, role, tx}) {
    try {
      // Fetch current permissions for user in org
      const currentPermission = await PrismaFactory.findOne({
        model: modelConstants.MODELS.PERMISSION,
        query: {userId, organizationId},
        tx,
      });

      if (!currentPermission?.success || !currentPermission?.doc) {
        // No existing permission found — create fresh (shouldn't happen but safe fallback)
        return await this.createInitialPermissions({
          userId,
          organizationId,
          role,
          tx,
        });
      }

      // Create fresh default levels for the new role
      const newLevels = createDefaultLevels({roleValue: role});

      // Update the permission record with new role's defaults
      const {success, doc, error} = await PrismaFactory.updateOne({
        model: modelConstants.MODELS.PERMISSION,
        query: {id: currentPermission.doc.id},
        data: {levels: newLevels},
        tx,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }
};
