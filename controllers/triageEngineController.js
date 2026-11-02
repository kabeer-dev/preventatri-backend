const {
  TRIAGE_GREEN_FLAG_DEFAULT_LOOKBACK_DAYS,
} = require('../constants/triageEngineConstants');

const {
  GeneralErrorsFactories,
  TriageEngineResponsesFactories,
} = require('../factories');

const {TriageEngineServices} = require('../services');

const {getCurrentTime, toLuxonUTC} = require('../utils/dateUtils');
const {getListParams} = require('../utils/general');

module.exports = class TriageEngineController {
  static async getActiveFlagStats(req, res, next) {
    const {startDate, endDate} = req.query;

    const token = req.extra.jwtToken;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    // GREEN flag window defaults to the last 30 days; the frontend can override
    // with explicit startDate/endDate query params.
    const greenEndDate = endDate || getCurrentTime();

    const greenStartDate =
      startDate ||
      toLuxonUTC({date: greenEndDate})
        .minus({days: TRIAGE_GREEN_FLAG_DEFAULT_LOOKBACK_DAYS})
        .toJSDate();

    const {
      success,
      activeRedFlags,
      activeYellowFlags,
      greenFlags,
      slaBreaches,
      error,
    } = await TriageEngineServices.getFlagStats({
      organizationId,
      greenStartDate,
      greenEndDate,
    });

    if (!success || error)
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch triage engine stats',
      });

    return TriageEngineResponsesFactories.activeFlagStatsRetrieved({
      stats: {activeRedFlags, activeYellowFlags, greenFlags, slaBreaches},
    });
  }

  static async getRecentAlerts(req, res, next) {
    const {page, limit, skip} = getListParams({req});

    const token = req.extra.jwtToken;
    const organizationId = token.user.currentActiveOrganization.organizationId;
    const {flag, regionId: regionIds} = req.query;

    const {success, alerts, count, error} =
      await TriageEngineServices.getRecentAlerts({
        organizationId,
        flag,
        regionIds,
        skip,
        take: limit,
      });

    if (!success || error)
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch triage engine alerts',
      });

    return TriageEngineResponsesFactories.alertsRetrieved({
      alerts,
      meta: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        count,
        totalPages: Math.ceil(count / limit),
      },
    });
  }
};
