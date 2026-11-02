const {COUNTIES_SORT_FIELDS} = require('../constants/countiesConstants');

const {
  GeneralErrorsFactories,
  CountiesResponsesFactories,
  GeneralResponsesFactories,
} = require('../factories');
const {CountiesServices, RegionsServices} = require('../services');

const {
  getListParams,
  buildOrderByClause,
  withIdTieBreaker,
} = require('../utils/general');

module.exports = class CountiesController {
  /**
   * List all counties in organization
   * GET /counties
   * Supports filtering by regionId
   */
  static async listCounties(req, res, next) {
    const {page, limit, skip, search, sortBy, sortDir} = getListParams({req});
    const {regionId, regionIsActive} = req.query;

    // Build sort object for Prisma
    const orderBy = buildOrderByClause({
      sortBy,
      sortDir,
      sortFields: COUNTIES_SORT_FIELDS,
    });

    const {
      success,
      docs: counties,
      error,
      count,
    } = await CountiesServices.listCounties({
      regionId: regionId || undefined,
      regionIsActive:
        regionIsActive !== undefined ? regionIsActive === 'true' : undefined,
      search,
      skip,
      take: limit,
      sort: withIdTieBreaker({orderBy}),
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch counties',
      });
    }

    return CountiesResponsesFactories.countiesListRetrieved({
      counties,
      meta: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        count,
        totalPages: Math.ceil(count / limit),
      },
    });
  }

  /**
   * List US counties an admin can add to a region
   * GET /counties/reference
   * Supports search and filtering by stateCode
   */
  static async listReferenceCounties(req, res, next) {
    const {page, limit, skip, search} = getListParams({req});

    const {docs: counties, count} = CountiesServices.listReferenceCounties({
      search,
      stateCode: req.query.stateCode,
      skip,
      take: limit,
    });

    return CountiesResponsesFactories.countiesListRetrieved({
      counties,
      meta: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        count,
        totalPages: Math.ceil(count / limit),
      },
    });
  }

  /**
   * Get a single county by ID
   * GET /counties/:id
   */
  static async getCounty(req, res, next) {
    const {id} = req.params;

    const {success, doc: county} = await CountiesServices.getCountyById({
      id,
      options: {
        fieldsInclusion: {include: ['region']},
      },
    });

    if (!success || !county) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'County not found',
      });
    }

    return GeneralResponsesFactories.dataRetrievedSuccessfully({
      data: county,
      key: 'county',
    });
  }

  /**
   * Get counties for a specific region
   * GET /counties/regions/:regionId
   */
  static async getCountiesByRegion(req, res, next) {
    const {regionId} = req.params;

    // Verify region exists
    const {success: regionSuccess, doc: region} =
      await RegionsServices.getRegionById({id: regionId});

    if (!regionSuccess || !region) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Region not found',
      });
    }

    const {
      success,
      docs: counties,
      error,
    } = await CountiesServices.getCountiesByRegion({regionId});

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch counties',
      });
    }

    return CountiesResponsesFactories.countiesListRetrieved({
      counties,
    });
  }
};
