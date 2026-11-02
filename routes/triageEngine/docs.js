const {createSwaggerDocs} = require('../../utils/swaggerUtils');

module.exports = {
  '/api/v1/triage-engine/stats': {
    get: createSwaggerDocs({
      tags: ['Triage Engine'],
      summary: 'Get flag stats',
      description:
        "Returns counts of currently-active escalations grouped by flag colour (red and yellow), plus the total GREEN flags created within a date window (default last 30 days, overridable via startDate/endDate). Scoped to the caller's active organization.",
      parameters: [
        {
          in: 'query',
          name: 'startDate',
          schema: {type: 'string', format: 'date-time'},
          description:
            'Start of the GREEN flag count window (inclusive). Defaults to 30 days before endDate.',
        },
        {
          in: 'query',
          name: 'endDate',
          schema: {type: 'string', format: 'date-time'},
          description:
            'End of the GREEN flag count window (inclusive). Defaults to now.',
        },
      ],
      responses: {
        200: {
          description: 'Triage engine stats retrieved successfully',
          message: {
            description: 'A message describing the result',
            example: 'Triage engine stats retrieved successfully',
          },
          body: {
            description: 'Flag counts by colour',
            type: 'object',
            properties: {
              activeRedFlags: {type: 'integer', example: 4},
              activeYellowFlags: {type: 'integer', example: 9},
              greenFlags: {type: 'integer', example: 27},
              slaBreaches: {
                type: 'integer',
                description:
                  'Escalation step deadlines missed in the last 30 days; a flag that escalated three times counts three',
                example: 2,
              },
              type: {
                type: 'string',
                example: 'TRIAGE_ENGINE_ACTIVE_FLAG_STATS_RETRIEVED',
              },
            },
          },
        },
        400: {
          description: 'Bad request - Invalid query parameters',
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Requires admin, nurse or case manager role',
        },
      },
    }),
  },
  '/api/v1/triage-engine/alerts': {
    get: createSwaggerDocs({
      tags: ['Triage Engine'],
      summary: 'Get system alerts',
      description:
        "Returns paginated submission flags (all colours), newest first, plus pagination meta. Raw enum values only — the frontend maps flag/type to titles and colours. Scoped to the caller's active organization.",
      parameters: [
        {
          in: 'query',
          name: 'page',
          schema: {type: 'integer', minimum: 1, default: 1},
          description: 'Page number (1-based).',
        },
        {
          in: 'query',
          name: 'limit',
          schema: {type: 'integer', minimum: 1, maximum: 100, default: 25},
          description: 'Number of alerts per page.',
        },
        {
          in: 'query',
          name: 'flag',
          schema: {type: 'string', enum: ['RED', 'YELLOW', 'GREEN']},
          description: 'Only alerts of this flag colour.',
        },
        {
          in: 'query',
          name: 'regionId',
          schema: {type: 'string'},
          description:
            "Comma-separated region UUIDs. Matches alerts whose patient's county is in one of the regions.",
        },
      ],
      responses: {
        200: {
          description: 'Triage engine alerts retrieved successfully',
          message: {
            description: 'A message describing the result',
            example: 'Triage engine alerts retrieved successfully',
          },
          body: {
            description: 'Recent submission flags plus the org-wide total',
            type: 'object',
            properties: {
              alerts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: {type: 'string', format: 'uuid'},
                    flag: {
                      type: 'string',
                      enum: ['GREEN', 'YELLOW', 'RED'],
                      example: 'RED',
                    },
                    type: {
                      type: 'string',
                      enum: ['AUTO', 'MANUAL'],
                      example: 'AUTO',
                    },
                    reason: {type: 'integer', example: 7},
                    status: {type: 'string', example: 'ESCALATED'},
                    createdAt: {type: 'string', format: 'date-time'},
                    submissionId: {
                      type: 'string',
                      format: 'uuid',
                      nullable: true,
                      description:
                        'Linked checklist submission for AUTO alerts; null for MANUAL (caregiver-raised) alerts.',
                    },
                    patient: {
                      type: 'object',
                      properties: {
                        firstName: {type: 'string', example: 'Diana'},
                        lastName: {type: 'string', example: 'Prince'},
                      },
                    },
                    submitter: {
                      type: 'object',
                      properties: {
                        firstName: {type: 'string', example: 'Lester'},
                        lastName: {type: 'string', example: 'McCarthy'},
                      },
                    },
                  },
                },
              },
              meta: {
                type: 'object',
                properties: {
                  page: {type: 'integer', example: 1},
                  limit: {type: 'integer', example: 25},
                  count: {type: 'integer', example: 78},
                  totalPages: {type: 'integer', example: 4},
                },
              },
              type: {
                type: 'string',
                example: 'TRIAGE_ENGINE_ALERTS_RETRIEVED',
              },
            },
          },
        },
        400: {
          description: 'Bad request - Invalid query parameters',
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Requires admin role',
        },
      },
    }),
  },
};
