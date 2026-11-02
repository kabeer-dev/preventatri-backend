const {createSwaggerDocs} = require('../../utils/swaggerUtils');

module.exports = {
  '/api/v1/health/database': {
    get: createSwaggerDocs({
      tags: ['Health'],
      summary: 'Check database connection status',
      description:
        'Returns the current health status of the database connection. Used for monitoring and readiness probes.',
      isAuthorizedEndpoint: false,
      responses: {
        200: {
          description: 'Database is healthy',
          message: {
            description: 'Health status message',
            example: 'Database connection is healthy',
          },
          body: {
            description: 'Health check result',
            type: 'object',
            properties: {
              status: {
                type: 'string',
                example: 'healthy',
                description: 'Database connection status',
              },
            },
          },
        },
        503: {
          description: 'Service Unavailable - Database connection failed',
          message: {
            description: 'Error message',
            example: 'Database connection failed',
          },
        },
      },
    }),
  },
};
