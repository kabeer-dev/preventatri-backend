/**
 * Database Health Check Controller
 * Provides endpoints to monitor database connection status
 */

const {HealthResponsesFactories} = require('../factories');
const {databaseConnectionManager} = require('../utils');

/**
 * GET /api/v1/health/database
 * Check database connection status
 */
const getHealth = async (req, res, next) => {
  const health = await databaseConnectionManager.healthCheck();

  if (health.healthy) {
    return HealthResponsesFactories.databaseHealthy({
      data: health,
    });
  } else {
    return HealthResponsesFactories.databaseUnhealthy({
      data: health,
    });
  }
};

module.exports = {
  getHealth,
};
