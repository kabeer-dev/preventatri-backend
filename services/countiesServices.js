const {modelConstants} = require('../constants');
const {PrismaFactory} = require('../factories');
const {buildNameSearchClause, safeMerge} = require('../utils/general');
const {buildCountyLookup} = require('../utils/hhaExchange/countyResolver');

const {
  getReferenceCounty,
  formatCountyLabel,
  searchReferenceCounties,
} = require('../utils/usCountyUtils');

module.exports = class CountiesServices {
  /**
   * Get county by ID
   */
  static async getCountyById({id, options = {}}) {
    try {
      const {success, doc, error} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.COUNTY,
        query: {id},
        options,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * List all counties for an organization
   * Supports filtering by regionId
   * NOTE: organizationId is automatically added from request context via buildWhereClause
   */
  static async listCounties({
    regionId,
    regionIsActive,
    search,
    skip = 0,
    take = 25,
    sort = null,
    options = {},
  }) {
    try {
      const query = {};

      if (regionId !== undefined) {
        query.regionId = regionId;
      }

      if (regionIsActive !== undefined) {
        query.region = {isActive: regionIsActive};
      }

      const searchClause = buildNameSearchClause({
        name: search,
        fields: ['name'],
      });
      if (searchClause) Object.assign(query, searchClause);

      // Build options with pagination and sorting using safeMerge
      const queryOptions = safeMerge({
        originalObj: {
          skip,
          take,
        },
        newObj: sort ? {sort} : {},
      });

      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.COUNTY,
        query,
        options: safeMerge({originalObj: options, newObj: queryOptions}),
        fieldsInclusion: options.fieldsInclusion,
      });

      // Fetch count for pagination
      const countResult = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.COUNTY,
        query,
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

  /**
   * Create a new county
   * regionId is REQUIRED — every county must belong to a region
   */
  static async createCounty({
    name,
    regionId,
    organizationId,
    isActive = true,
    tx,
  }) {
    try {
      const data = {
        name,
        regionId,
        organizationId,
        isActive,
      };

      const {success, doc, error} = await PrismaFactory.create({
        model: modelConstants.MODELS.COUNTY,
        data,
        tx,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * US counties an admin can add to a region, from the reference data.
   * Not organization data, so there is no query to scope.
   */
  static listReferenceCounties({search, stateCode, skip, take}) {
    return searchReferenceCounties({search, stateCode, skip, take});
  }

  /**
   * Bulk create counties for a region
   * Uses PrismaFactory.createManyAndReturn for single DB round-trip
   * Name and state come from the reference data, never from the client.
   * @param {string[]} fipsCodes - County FIPS codes to create
   * @param {string} regionId - Region to assign counties to
   * @param {string} organizationId - Organization scope
   * @param {object} tx - Prisma transaction client
   * @returns {object} - {success, docs, error}
   */
  static async bulkCreateCounties({fipsCodes, regionId, organizationId, tx}) {
    try {
      const data = fipsCodes.map((fipsCode) => {
        const {name, stateCode} = getReferenceCounty({fipsCode});

        return {
          name,
          stateCode,
          fipsCode,
          regionId,
          organizationId,
          isActive: true,
        };
      });

      const {success, docs, error} = await PrismaFactory.createManyAndReturn({
        model: modelConstants.MODELS.COUNTY,
        data,
        tx,
      });

      return {success, docs: docs || [], error};
    } catch (error) {
      return {success: false, docs: [], error};
    }
  }

  /**
   * Delete a county (hard delete — County has no soft-delete)
   */
  static async deleteCounty({id, tx}) {
    try {
      const {success, error, isDocumentDeleted} =
        await PrismaFactory.hardDeleteOne({
          model: modelConstants.MODELS.COUNTY,
          query: {id},
          tx,
        });

      return {success: success && isDocumentDeleted, error};
    } catch (error) {
      return {success: false, error};
    }
  }

  /**
   * Bulk delete counties by IDs
   * Uses PrismaFactory.hardDeleteMany for single DB round-trip
   * @param {string[]} countyIds - Array of county IDs to delete
   * @param {object} tx - Prisma transaction client
   * @returns {object} - {success, error, deletedCount, areDocumentsDeleted}
   */
  static async bulkDeleteCounties({countyIds, tx}) {
    try {
      const {success, error, responseObj, areDocumentsDeleted} =
        await PrismaFactory.hardDeleteMany({
          model: modelConstants.MODELS.COUNTY,
          query: {id: {in: countyIds}},
          tx,
        });

      return {
        success: success && areDocumentsDeleted,
        error,
        deletedCount: responseObj?.count || 0,
      };
    } catch (error) {
      return {success: false, error, deletedCount: 0};
    }
  }

  /**
   * Find the counties among the given FIPS codes that the organization
   * already has (a county belongs to one region per organization).
   *
   * @param {string[]} fipsCodes - County FIPS codes to check
   * @param {string} organizationId - Organization scope
   * @param {object} [tx] - Optional Prisma transaction client
   * @returns {Promise<string[]>} - Labels of the conflicting counties
   */
  static async findConflictingCounties({fipsCodes, organizationId, tx}) {
    try {
      if (!fipsCodes || fipsCodes.length === 0) return [];

      const {success, docs} = await PrismaFactory.find({
        model: modelConstants.MODELS.COUNTY,
        query: {organizationId, fipsCode: {in: fipsCodes}},
        fieldsInclusion: {includeSpecificFields: ['name', 'stateCode']},
        options: {bypassExtraQueries: true},
        tx,
      });

      if (!success) return [];

      return docs.map((county) => formatCountyLabel(county));
    } catch (error) {
      return [];
    }
  }

  /**
   * Every county in an organization, for callers with no request context.
   *
   * listCounties scopes by the request's organization, which a background sync
   * does not have, so the scope is an argument here instead.
   *
   * @param {string} organizationId - Organization scope
   * @param {object} [tx] - Optional Prisma transaction client
   * @returns {Promise<{success: boolean, docs: object[], error: *}>}
   */
  static async listCountiesForOrganization({organizationId, tx}) {
    try {
      const {success, docs, error} = await PrismaFactory.find({
        model: modelConstants.MODELS.COUNTY,
        query: {organizationId},
        fieldsInclusion: {
          includeSpecificFields: ['id', 'name', 'regionId', 'fipsCode'],
        },
        options: {bypassExtraQueries: true},
        tx,
      });

      if (!success) return {success: false, docs: [], error};

      return {success: true, docs, error: null};
    } catch (error) {
      return {success: false, docs: [], error};
    }
  }

  /**
   * The organization's counties keyed for ZIP resolution. Built per call, never
   * cached: each organization sets up its own counties.
   */
  static async buildCountyLookupForOrganization({organizationId}) {
    const {success, docs, error} =
      await CountiesServices.listCountiesForOrganization({organizationId});

    return {success, countyLookup: buildCountyLookup({counties: docs}), error};
  }

  /**
   * Get counties by region ID
   */
  static async getCountiesByRegion({regionId, options = {}}) {
    try {
      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.COUNTY,
        query: {regionId, isActive: true},
        options,
        fieldsInclusion: options.fieldsInclusion,
      });

      return result;
    } catch (error) {
      return {success: false, docs: [], error};
    }
  }
};
