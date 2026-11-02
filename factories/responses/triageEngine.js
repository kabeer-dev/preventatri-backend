const AppResponse = require('./app');

const {
  TRIAGE_ENGINE_SUCCESS_TYPES,
} = require('../../constants/responses/success/triageEngine');

module.exports = class TriageEngineResponsesFactories {
  static activeFlagStatsRetrieved({stats}) {
    return new AppResponse({
      message: 'Triage engine stats retrieved successfully',
      statusCode: 200,
      body: {
        activeRedFlags: stats.activeRedFlags,
        activeYellowFlags: stats.activeYellowFlags,
        greenFlags: stats.greenFlags,
        slaBreaches: stats.slaBreaches,
        type: TRIAGE_ENGINE_SUCCESS_TYPES.activeFlagStatsRetrieved.value,
      },
    });
  }

  static alertsRetrieved({alerts, meta}) {
    return new AppResponse({
      message: 'Triage engine alerts retrieved successfully',
      statusCode: 200,
      body: {
        alerts,
        meta,
        type: TRIAGE_ENGINE_SUCCESS_TYPES.alertsRetrieved.value,
      },
    });
  }
};
