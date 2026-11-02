const {
  GeneralErrorsFactories,
  GlobalSearchResponsesFactories,
} = require('../factories');

const {GlobalSearchServices} = require('../services');

module.exports = class GlobalSearchController {
  /**
   * Search patients and staff for the admin dashboard.
   * GET /search
   *
   * Query params are validated by route middleware. `limit` caps each group.
   * Scoped to the caller's active organization. Admin only.
   */
  static async searchAll(req, res, next) {
    const {search, limit} = req.query;

    const organizationId =
      req.extra.jwtToken.user.currentActiveOrganization.organizationId;

    const [patientsResult, staffResult] = await Promise.all([
      GlobalSearchServices.searchPatients({search, take: limit}),
      GlobalSearchServices.searchStaff({search, organizationId, take: limit}),
    ]);

    if (!patientsResult.success || !staffResult.success)
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch search results',
      });

    return GlobalSearchResponsesFactories.globalSearchResultsRetrieved({
      patients: patientsResult.docs,
      staff: staffResult.docs,
    });
  }
};
