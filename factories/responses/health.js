const config = require('config');

const AppResponse = require('./app');

module.exports = class HealthResponsesFactories {
  static healthStatus({health, message, details, statusCode = 200}) {
    return new AppResponse({
      message: message,
      statusCode: statusCode,
      body: {
        health,
        details,
      },
    });
  }

  static databaseHealthy({data}) {
    return this.healthStatus({
      health: 'healthy',
      message: 'Database connection is healthy',
      details: data,
      statusCode: 200,
    });
  }

  static databaseUnhealthy({data}) {
    return this.healthStatus({
      health: 'unhealthy',
      message: 'Database connection is unhealthy',
      details: data,
      statusCode: 503,
    });
  }

  static healthCheckFailed({error}) {
    // Sanitize error message for production to prevent information leakage
    const safeMessage = config.get('envVariables.prod')
      ? 'Internal error during health check'
      : error.message;

    return this.healthStatus({
      health: 'error',
      message: 'Health check failed',
      details: {error: safeMessage},
      statusCode: 500,
    });
  }
};
