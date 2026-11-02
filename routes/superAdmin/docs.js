const {
  ORGANIZATION_STATUSES_VALUES,
} = require('../../constants/organizationsConstants');

const {
  createSwaggerDocs,
  createIdPathParam,
} = require('../../utils/swaggerUtils');

const organizationIdParam = createIdPathParam({
  name: 'id',
  description: 'Organization id',
});

const decisionResponses = ({done, wrongStatus}) => ({
  200: {
    description: done,
    message: {
      description: 'Success message',
      example: 'Data updated successfully',
    },
    body: {
      description: 'Response body',
      type: 'object',
      properties: {
        organization: {
          type: 'object',
          properties: {
            id: {type: 'string', format: 'uuid'},
            status: {type: 'string', enum: ORGANIZATION_STATUSES_VALUES},
            statusReason: {type: 'string', nullable: true},
          },
        },
      },
    },
  },
  403: {
    description:
      'Forbidden - Not the super admin, or the target is the super admin organization itself',
    message: {description: 'Error message', example: 'Forbidden'},
  },
  404: {
    description: 'Not Found - No such organization',
    message: {description: 'Error message', example: 'Organization not found'},
  },
  409: {
    description: wrongStatus,
    message: {
      description: 'Error message',
      example:
        'Only a pending organization can be approved. This one is active.',
    },
  },
});

const reasonBody = {
  fields: {
    reason: {
      type: 'string',
      description:
        'Why, up to 1000 characters. Optional. Shown in the email to the organization admin.',
      example: 'Could not verify the organization.',
    },
  },
  required: [],
};

module.exports = {
  '/api/v1/super-admin/organizations': {
    get: createSwaggerDocs({
      tags: ['Super Admin'],
      summary: 'List organizations',
      description:
        "Lists every organization except the super admin's own, newest first, with its status and founding admin. Super admin only. It never returns an organization's own data.",
      isAuthorizedEndpoint: true,
      parameters: [
        {
          in: 'query',
          name: 'status',
          schema: {type: 'string', enum: ORGANIZATION_STATUSES_VALUES},
          description: 'Only organizations in this status',
        },
        {
          in: 'query',
          name: 'search',
          schema: {type: 'string'},
          description: 'Part of the organization name',
        },
        {in: 'query', name: 'page', schema: {type: 'integer', default: 1}},
        {in: 'query', name: 'limit', schema: {type: 'integer', default: 25}},
      ],
      responses: {
        200: {
          description: 'Organizations retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Data retrieved successfully',
          },
          body: {
            description: 'Response body',
            type: 'object',
            properties: {
              result: {
                type: 'object',
                properties: {
                  organizations: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: {type: 'string', format: 'uuid'},
                        organizationName: {type: 'string'},
                        status: {
                          type: 'string',
                          enum: ORGANIZATION_STATUSES_VALUES,
                        },
                        statusReason: {type: 'string', nullable: true},
                        statusChangedAt: {
                          type: 'string',
                          format: 'date-time',
                          nullable: true,
                        },
                        createdAt: {type: 'string', format: 'date-time'},
                        creator: {
                          type: 'object',
                          description: 'The founding admin',
                          properties: {
                            id: {type: 'string', format: 'uuid'},
                            firstName: {type: 'string'},
                            lastName: {type: 'string'},
                            email: {type: 'string'},
                          },
                        },
                      },
                    },
                  },
                  meta: {
                    type: 'object',
                    properties: {
                      page: {type: 'integer'},
                      limit: {type: 'integer'},
                      total: {type: 'integer'},
                    },
                  },
                },
              },
            },
          },
        },
        403: {
          description: 'Forbidden - Not the super admin',
          message: {description: 'Error message', example: 'Forbidden'},
        },
      },
    }),
  },
  '/api/v1/super-admin/organizations/{id}/approve': {
    post: createSwaggerDocs({
      tags: ['Super Admin'],
      summary: 'Approve a pending organization',
      description:
        'Moves a pending organization to active, so everyone in it can log in, and emails its founding admin. Super admin only.',
      isAuthorizedEndpoint: true,
      parameters: [organizationIdParam],
      responses: decisionResponses({
        done: 'Organization approved',
        wrongStatus: 'Conflict - The organization is not pending',
      }),
    }),
  },
  '/api/v1/super-admin/organizations/{id}/reject': {
    post: createSwaggerDocs({
      tags: ['Super Admin'],
      summary: 'Reject a pending organization',
      description:
        'Moves a pending organization to rejected, so nobody in it can log in, and emails its founding admin with the reason. Super admin only.',
      isAuthorizedEndpoint: true,
      parameters: [organizationIdParam],
      requestBody: reasonBody,
      responses: decisionResponses({
        done: 'Organization rejected',
        wrongStatus: 'Conflict - The organization is not pending',
      }),
    }),
  },
  '/api/v1/super-admin/organizations/{id}/suspend': {
    post: createSwaggerDocs({
      tags: ['Super Admin'],
      summary: 'Suspend an active organization',
      description:
        'Moves an active organization to suspended. Nobody in it can log in and their open sessions end. Emails its founding admin with the reason. Super admin only.',
      isAuthorizedEndpoint: true,
      parameters: [organizationIdParam],
      requestBody: reasonBody,
      responses: decisionResponses({
        done: 'Organization suspended',
        wrongStatus: 'Conflict - The organization is not active',
      }),
    }),
  },
  '/api/v1/super-admin/organizations/{id}/reactivate': {
    post: createSwaggerDocs({
      tags: ['Super Admin'],
      summary: 'Reactivate a suspended organization',
      description:
        'Moves a suspended organization back to active, so everyone in it can log in again, and emails its founding admin. Super admin only.',
      isAuthorizedEndpoint: true,
      parameters: [organizationIdParam],
      responses: decisionResponses({
        done: 'Organization reactivated',
        wrongStatus: 'Conflict - The organization is not suspended',
      }),
    }),
  },
};
