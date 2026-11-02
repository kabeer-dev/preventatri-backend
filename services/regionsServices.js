const {modelConstants} = require('../constants');
const {NURSE_REGION_ROLES} = require('../constants/nursesConstants');
const {REGION_ARCHIVE_FILTERS} = require('../constants/regionsConstants');
const {PrismaFactory} = require('../factories');
const {buildNameSearchClause, safeMerge} = require('../utils/general');

const {computeRoleAssignmentPlan} = require('../utils/nurseRegionUtils');

/**
 * Shape a single NurseRegion roster row's nurseProfile into the lightweight
 * nurse reference ({id, status, user}) used by region API responses.
 */
const buildRegionNurseRef = ({nurseProfile}) => ({
  id: nurseProfile.id,
  status: nurseProfile.status,
  user: nurseProfile.user,
});

module.exports = class RegionsServices {
  /**
   * Get region by ID
   * Includes counties relation for edit form (auto-included via MODEL_SCHEMA_CONFIG)
   */
  static async getRegionById({id, options = {}}) {
    try {
      const {success, doc, error} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.REGION,
        query: {id},
        options,
      });

      return {
        success,
        doc: RegionsServices.attachNurseRoleLists({region: doc}),
        error,
      };
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Derive primaryNurses[] / secondaryNurses[] lightweight refs from a region's
   * regionDefaultNurses roster (region-owned default nurses, auto-included via
   * MODEL_SCHEMA_CONFIG), skipping rows whose nurse profile is soft-deleted.
   * This roster is INDEPENDENT of a nurse's own region coverage (NurseRegion).
   * Mutates and returns the region so it can be used inline; safe to call with a
   * null region.
   */
  static attachNurseRoleLists({region}) {
    if (!region) return region;

    const activeRows = (region.regionDefaultNurses || []).filter(
      (nurseRegion) =>
        nurseRegion.nurseProfile && nurseRegion.nurseProfile.isDeleted === null
    );

    region.primaryNurses = activeRows
      .filter(
        (nurseRegion) =>
          nurseRegion.nurseRegionRole === NURSE_REGION_ROLES.PRIMARY
      )
      .map((nurseRegion) =>
        buildRegionNurseRef({nurseProfile: nurseRegion.nurseProfile})
      );

    region.secondaryNurses = activeRows
      .filter(
        (nurseRegion) =>
          nurseRegion.nurseRegionRole === NURSE_REGION_ROLES.SECONDARY
      )
      .map((nurseRegion) =>
        buildRegionNurseRef({nurseProfile: nurseRegion.nurseProfile})
      );

    delete region.regionDefaultNurses;

    return region;
  }

  /**
   * Get region by code within an organization
   * IMPORTANT: Explicitly filters out soft-deleted records since Prisma doesn't support
   * partial unique indexes in schema syntax. Database has:
   * UNIQUE INDEX(code, organizationId) WHERE deleted_at IS NULL
   */
  static async getRegionByCode({code, organizationId, options = {}}) {
    try {
      const query = {
        code,
        organizationId,
        isDeleted: null, // Explicitly exclude soft-deleted records
      };

      const {success, doc, error} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.REGION,
        query,
        options,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * List all regions for an organization
   * Includes counties relation for UI table
   * NOTE: organizationId is automatically added from request context via buildWhereClause
   */
  static async listRegions({
    isActive,
    archiveFilter = REGION_ARCHIVE_FILTERS.ACTIVE.value,
    search,
    skip = 0,
    take = 25,
    sort = null,
    options = {},
  }) {
    try {
      const query = {};

      if (isActive !== undefined) {
        query.isActive = isActive;
      }

      // active -> live only (the default soft-delete filter); all -> live and
      // archived; archived -> only soft-deleted regions.
      const includeArchived =
        archiveFilter !== REGION_ARCHIVE_FILTERS.ACTIVE.value;

      if (archiveFilter === REGION_ARCHIVE_FILTERS.ARCHIVED.value) {
        query.isDeleted = {not: null};
      }

      const searchClause = buildNameSearchClause({
        name: search,
        fields: ['name', 'code'],
      });
      if (searchClause) Object.assign(query, searchClause);

      // Build options with pagination and sorting using safeMerge
      const queryOptions = safeMerge({
        originalObj: {
          skip,
          take,
          includeDeleted: includeArchived,
        },
        newObj: sort ? {sort} : {},
      });

      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.REGION,
        query,
        options: safeMerge({originalObj: options, newObj: queryOptions}),

        // isDeleted is not a default region field, and the archived flag below
        // is derived from it.
        fieldsInclusion: options.fieldsInclusion ?? {include: ['isDeleted']},
      });

      // Fetch count for pagination
      const countResult = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.REGION,
        query,
        options: {includeDeleted: includeArchived},
      });

      // Derive primaryNurses[] / secondaryNurses[] from each region's roster
      (result.docs || []).forEach((region) => {
        RegionsServices.attachNurseRoleLists({region});

        // Lets the list lock an archived region without reading isDeleted.
        region.archived = Boolean(region.isDeleted);
      });

      return safeMerge({
        originalObj: result,
        newObj: {
          count: countResult.success ? countResult.count : 0,
        },
      });
    } catch (error) {
      return {success: false, docs: [], error, count: 0};
    }
  }

  static async createRegion({name, code, organizationId, isActive = true, tx}) {
    try {
      const data = {
        name,
        code,
        organizationId,
        isActive,
      };

      const {success, doc, error} = await PrismaFactory.create({
        model: modelConstants.MODELS.REGION,
        data,
        tx,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Update a region
   * Uses findOneAndUpdate to return the updated document with counties
   */
  static async updateRegion({id, updateData, tx}) {
    try {
      const {success, doc, error} = await PrismaFactory.findOneAndUpdate({
        model: modelConstants.MODELS.REGION,
        query: {id},
        data: updateData,
        tx,
        fieldsInclusion: {include: ['counties']},
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Assign multiple primary/secondary nurses to a region's DEFAULT nurse roster
   * (RegionDefaultNurse) using a merge/diff approach against the current rows.
   * PATCH semantics (an undefined role list is left untouched, an empty array
   * clears it). The DB unique(nurseProfileId, regionId) constraint guarantees a
   * nurse holds a single role per region. This roster is INDEPENDENT of a nurse's
   * own region coverage (NurseRegion) and of patient assignments — removing a
   * nurse here does NOT cascade to patients (PREVENT-411).
   */
  static async assignNursesToRegion({
    regionId,
    primaryNurseProfileIds,
    secondaryNurseProfileIds,
    organizationId,
    tx,
  }) {
    try {
      if (
        primaryNurseProfileIds === undefined &&
        secondaryNurseProfileIds === undefined
      ) {
        return {success: true, error: null};
      }

      const currentRowsResult = await PrismaFactory.find({
        model: modelConstants.MODELS.REGION_DEFAULT_NURSE,
        query: {regionId, organizationId},
        tx,
      });

      if (!currentRowsResult.success) {
        return {
          success: false,
          error: currentRowsResult.error,
        };
      }

      const {toDelete, toCreate, toUpdate} = computeRoleAssignmentPlan({
        currentRows: currentRowsResult.docs || [],
        keyField: 'nurseProfileId',
        primaryIds: primaryNurseProfileIds,
        secondaryIds: secondaryNurseProfileIds,
      });

      if (toDelete.length > 0) {
        const {success, error} = await PrismaFactory.hardDeleteMany({
          model: modelConstants.MODELS.REGION_DEFAULT_NURSE,
          query: {regionId, nurseProfileId: {in: toDelete}},
          tx,
        });

        if (!success) {
          return {success: false, error};
        }
      }

      if (toCreate.length > 0) {
        const data = toCreate.map(({nurseProfileId, nurseRegionRole}) => ({
          nurseProfileId,
          regionId,
          organizationId,
          nurseRegionRole,
        }));

        const {success, error} = await PrismaFactory.create({
          model: modelConstants.MODELS.REGION_DEFAULT_NURSE,
          data,
          tx,
        });

        if (!success) {
          return {success: false, error};
        }
      }

      for (const {nurseProfileId, nurseRegionRole} of toUpdate) {
        const {success, error} = await PrismaFactory.updateMany({
          model: modelConstants.MODELS.REGION_DEFAULT_NURSE,
          query: {regionId, nurseProfileId},
          data: {nurseRegionRole},
          tx,
        });

        if (!success) {
          return {success: false, error};
        }
      }

      return {success: true, error: null};
    } catch (error) {
      return {success: false, error};
    }
  }

  /**
   * Soft delete a region
   */
  static async deleteRegion({id, tx}) {
    try {
      const {success, doc, error} = await PrismaFactory.softDeleteOne({
        model: modelConstants.MODELS.REGION,
        query: {id},
        tx,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Get regions with summary counts (nurses, counties, patients, case managers)
   * NOTE: organizationId is automatically scoped via request context
   */
  static async getRegionsWithSummaryCounts() {
    try {
      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.REGION,
        query: {isActive: true},
        fieldsInclusion: {
          include: {
            regionDefaultNurses: {
              where: {
                nurseProfile: {
                  isDeleted: null, // Filter at database level: only non-deleted nurses
                },
              },
              select: {
                id: true,
              },
            },
            counties: {
              select: {
                id: true,
                patients: {
                  where: {
                    isDeleted: null, // Only non-deleted patients
                  },
                  select: {
                    id: true,
                  },
                },
              },
            },
            caseManagerRegions: {
              where: {
                caseManagerProfile: {
                  isDeleted: null, // Only non-deleted case managers
                },
              },
              select: {
                id: true,
              },
            },
          },
        },
      });

      if (!result.success) {
        return {success: result.success, docs: [], error: result.error};
      }

      // Transform to include all counts
      const regionsWithCounts = result.docs.map((region) => ({
        id: region.id,
        name: region.name,
        code: region.code,
        isActive: region.isActive,
        nurseCount: region.regionDefaultNurses?.length || 0,
        countyCount: region.counties?.length || 0,
        patientCount:
          region.counties?.reduce(
            (acc, county) => acc + (county.patients?.length || 0),
            0
          ) || 0,
        caseManagerCount: region.caseManagerRegions?.length || 0,
      }));

      return {success: true, docs: regionsWithCounts, error: null};
    } catch (error) {
      return {success: false, docs: [], error};
    }
  }

  /**
   * Get nurses assigned to a region
   * Filters out soft-deleted nurse profiles after fetching
   */
  static async getNursesInRegion({regionId, options = {}}) {
    try {
      const defaultOptions = {
        fieldsInclusion: {
          include: {
            nurseProfile: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    phoneNo: true,
                  },
                },
              },
            },
          },
        },
      };

      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.REGION_DEFAULT_NURSE,
        query: {regionId},
        options: safeMerge({originalObj: defaultOptions, newObj: options}),
        fieldsInclusion:
          options.fieldsInclusion || defaultOptions.fieldsInclusion,
      });

      // Filter out nurse regions where nurseProfile is soft-deleted
      // Since NurseRegion doesn't have isDeleted, we check the nested nurseProfile.isDeleted
      // No need for success/docs guard — .filter() on empty array returns []
      const filteredDocs = (result.docs || []).filter(
        (nr) => nr.nurseProfile && nr.nurseProfile.isDeleted === null
      );

      return {
        success: result.success,
        docs: filteredDocs,
        error: result.error,
      };
    } catch (error) {
      return {success: false, docs: [], error};
    }
  }

  /**
   * Validate that region IDs exist and belong to the organization
   * NOTE: organizationId is automatically scoped via request context through PrismaFactory.find
   */
  static async validateRegionIds({regionIds}) {
    try {
      // Query only the provided regionIds for efficiency and correctness
      const {success, docs: regions} = await PrismaFactory.find({
        model: modelConstants.MODELS.REGION,
        query: {
          id: {in: regionIds},
          isActive: true,
        },
      });

      if (!success) {
        return {
          valid: false,
          invalidIds: regionIds,
          error: new Error('Failed to fetch regions'),
        };
      }

      const validRegionIds = new Set(regions.map((r) => r.id));
      const invalidIds = regionIds.filter((id) => !validRegionIds.has(id));

      const isValid = invalidIds.length === 0;

      return {
        valid: isValid,
        invalidIds,
        error: isValid
          ? null
          : new Error(`Invalid region IDs: ${invalidIds.join(', ')}`),
      };
    } catch (error) {
      return {valid: false, invalidIds: regionIds, error: error.message};
    }
  }

  /**
   * Get patient count for a region (non-deleted patients only)
   */
  static async getPatientsInRegion({regionId}) {
    try {
      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.PATIENT,
        query: {
          county: {
            regionId,
          },
        },
      });

      return {
        success: result.success,
        docs: result.docs || [],
        error: result.error,
      };
    } catch (error) {
      return {success: false, docs: [], error};
    }
  }

  /**
   * Get case managers assigned to a region (via CaseManagerRegion junction)
   * Filters out soft-deleted case manager profiles
   */
  static async getCaseManagersInRegion({regionId}) {
    try {
      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.CASE_MANAGER_REGION,
        query: {regionId},
        fieldsInclusion: {
          include: {
            caseManagerProfile: {
              select: {
                id: true,
                userId: true,
                isDeleted: true,
              },
            },
          },
        },
      });

      // Filter out case manager regions where profile is soft-deleted
      const filteredDocs = (result.docs || []).filter(
        (cmr) =>
          cmr.caseManagerProfile && cmr.caseManagerProfile.isDeleted === null
      );

      return {
        success: result.success,
        docs: filteredDocs,
        error: result.error,
      };
    } catch (error) {
      return {success: false, docs: [], error};
    }
  }
};
