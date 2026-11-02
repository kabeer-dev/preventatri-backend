const {createSwaggerDocs} = require('../../utils/swaggerUtils');

module.exports = {
  '/api/v1/private/sample': {
    post: createSwaggerDocs({
      tags: ['Private'],
      summary: 'Private sample endpoint',
      description: 'A private sample endpoint that requires access control',
      responses: {
        200: {
          description: 'Private sample response',
          message: {
            description: 'Response message',
            example: 'Private Sample',
          },
        },
        403: {
          description: 'Forbidden - User does not have access to this resource',
          message: {
            description: 'Error message',
            example: 'Access denied',
          },
        },
      },
    }),
  },
};
