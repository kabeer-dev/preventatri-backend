const {createSwaggerDocs} = require('../../utils/swaggerUtils');

module.exports = {
  '/api/v1/public/sample': {
    post: createSwaggerDocs({
      tags: ['Public'],
      summary: 'Public sample endpoint',
      description:
        'A simple public sample endpoint with access middleware applied',
      isAuthorizedEndpoint: false,
      responses: {
        200: {
          description: 'Successful public sample response',
          message: {
            description: 'Response message',
            example: 'Public Sample',
          },
        },
        401: {
          description: 'Unauthorized - Access denied by middleware',
          message: {
            description: 'Error message',
            example: 'Unauthorized',
          },
        },
      },
    }),
  },
};
