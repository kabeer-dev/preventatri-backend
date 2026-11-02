const {createSwaggerDocs} = require('../../utils/swaggerUtils');

module.exports = {
  '/api/v1/sessions': {
    get: createSwaggerDocs({
      tags: ['Sessions'],
      summary: 'List active login sessions',
      description:
        'Returns the logged-in user\'s active sessions ("devices") — one ' +
        'per login. Each entry is labeled with a browser/OS parsed from ' +
        'the stored User-Agent, and isCurrent marks the session making ' +
        'this request. Use DELETE /sessions/signout/{sessionId} to revoke ' +
        'one, or DELETE /sessions/signout-other-devices to revoke every ' +
        'session except the current one.',
      responses: {
        200: {
          description: 'Sessions retrieved successfully',
          message: {
            description: 'A message describing the result of the operation',
            example: 'Sessions retrieved successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              sessions: {
                type: 'array',
                description: 'The active sessions for the logged-in user',
                items: {
                  type: 'object',
                  properties: {
                    id: {
                      type: 'string',
                      description: 'Unique identifier of the session',
                      example: '6718b50850537de87e6805e8',
                    },
                    device: {
                      type: 'string',
                      description:
                        "Device label parsed from the session's User-Agent",
                      example: 'PC',
                    },
                    browser: {
                      type: 'string',
                      description:
                        "Browser name parsed from the session's User-Agent",
                      example: 'Chrome',
                    },
                    os: {
                      type: 'string',
                      description:
                        "Operating system parsed from the session's User-Agent",
                      example: 'Windows',
                    },
                    platform: {
                      type: 'string',
                      description: 'Platform the session logged in from',
                      example: 'web',
                    },
                    ipAddress: {
                      type: 'string',
                      description: 'IP address the session logged in from',
                      example: '203.0.113.42',
                    },
                    createdAt: {
                      type: 'string',
                      format: 'date-time',
                      description: 'When this session was created (login time)',
                    },
                    isCurrent: {
                      type: 'boolean',
                      description:
                        'True if this is the session making the current request',
                      example: true,
                    },
                  },
                },
              },
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'SESSIONS_RETRIEVED_SUCCESSFULLY',
              },
            },
          },
        },
        401: {
          description:
            'Unauthorized - Authentication is required or has failed',
          message: {
            description: 'Error message',
            example: 'Unauthorized - Invalid or missing token',
          },
        },
      },
    }),
  },
  '/api/v1/sessions/signout-other-devices': {
    delete: createSwaggerDocs({
      tags: ['Sessions'],
      summary: 'Sign out of all other devices',
      description:
        'Revokes every active session for the logged-in user except the ' +
        'one making this request, signing them out of all other devices.',
      responses: {
        200: {
          description: 'Signed out of all other devices successfully',
          message: {
            description: 'A message describing the result of the operation',
            example: 'Signed out of all other devices successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'OTHER_SESSIONS_REVOKED_SUCCESSFULLY',
              },
            },
          },
        },
        401: {
          description:
            'Unauthorized - Authentication is required or has failed',
          message: {
            description: 'Error message',
            example: 'Unauthorized - Invalid or missing token',
          },
        },
      },
    }),
  },
  '/api/v1/sessions/signout/{sessionId}': {
    delete: createSwaggerDocs({
      tags: ['Sessions'],
      summary: 'Sign out of a single device',
      description:
        'Revokes the session identified by sessionId, signing that device ' +
        'out. Revoking the current session is allowed and also clears the ' +
        'auth cookie on this response.',
      parameters: [
        {
          in: 'path',
          name: 'sessionId',
          schema: {type: 'string'},
          description: 'Unique identifier of the session to revoke',
          example: '6718b50850537de87e6805e8',
          required: true,
        },
      ],
      responses: {
        200: {
          description: 'Session revoked successfully',
          message: {
            description: 'A message describing the result of the operation',
            example: 'Session revoked successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'SESSION_REVOKED_SUCCESSFULLY',
              },
            },
          },
        },
        401: {
          description:
            'Unauthorized - Authentication is required or has failed',
          message: {
            description: 'Error message',
            example: 'Unauthorized - Invalid or missing token',
          },
        },
        404: {
          description: 'Not Found - Session does not exist',
          message: {
            description: 'Error message',
            example: 'Session not found',
          },
        },
      },
    }),
  },
};
