const {createSwaggerDocs} = require('../../utils/swaggerUtils');

const workingHoursDaySchema = {
  type: 'object',
  properties: {
    enabled: {type: 'boolean', example: true},
    startTime: {
      type: 'string',
      description: 'HH:mm, 24-hour format',
      example: '09:00',
    },
    endTime: {
      type: 'string',
      description: 'HH:mm, 24-hour format',
      example: '17:00',
    },
  },
};

const workingHoursSchema = {
  type: 'object',
  description:
    'Weekly working hours, keyed by lowercase day name. Defaults to every day enabled 09:00-17:00 on organization creation.',
  properties: {
    monday: workingHoursDaySchema,
    tuesday: workingHoursDaySchema,
    wednesday: workingHoursDaySchema,
    thursday: workingHoursDaySchema,
    friday: workingHoursDaySchema,
    saturday: workingHoursDaySchema,
    sunday: workingHoursDaySchema,
  },
};

const timeZoneSchema = {
  type: 'object',
  description:
    "The organization's selected time zone, one of the 6 supported USA time zones. Defaults to Eastern on organization creation.",
  properties: {
    key: {
      type: 'string',
      description: 'The stored enum value',
      example: 'EASTERN',
    },
    value: {
      type: 'string',
      description: 'IANA time zone identifier',
      example: 'America/New_York',
    },
    label: {
      type: 'string',
      description: 'Display label',
      example: 'Eastern Time (US & Canada)',
    },
  },
};

const escalationPolicyStepSchema = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['PRIMARY_NURSE', 'SECONDARY_NURSE', 'CASE_MANAGER', 'ADMIN'],
      example: 'PRIMARY_NURSE',
    },
    ttlMinutes: {
      type: 'integer',
      nullable: true,
      description:
        'Minutes the step waits before escalating. Must be a whole number of ttlUnit (e.g. 120 for 2 HOURS). null on the final ADMIN step.',
      example: 5,
    },
    ttlUnit: {
      type: 'string',
      enum: ['MINUTES', 'HOURS'],
      nullable: true,
      description:
        'Unit the admin entered the timer in, for display. null on the final ADMIN step.',
      example: 'MINUTES',
    },
    channels: {
      type: 'array',
      description: 'How the step assignee is notified (IN_APP is "Push").',
      items: {type: 'string', enum: ['IN_APP', 'EMAIL', 'SMS']},
      example: ['IN_APP', 'EMAIL', 'SMS'],
    },
  },
};

// A step as returned by the API: the saved step plus its read-only region
// fallback (not accepted on save — it is derived from the step).
const escalationPolicyStepResponseSchema = {
  type: 'object',
  properties: Object.assign({}, escalationPolicyStepSchema.properties, {
    fallback: {
      type: 'object',
      nullable: true,
      description:
        "Read-only. The region nurse paged automatically when the patient's nurse doesn't respond within the deadline (or the patient has none), with the same deadline and channels as the step, before the flow moves to the next step. Present on PRIMARY_NURSE / SECONDARY_NURSE steps, null otherwise. Ignored if sent on save.",
      properties: {
        level: {
          type: 'string',
          enum: ['REGION_PRIMARY_NURSE', 'REGION_SECONDARY_NURSE'],
          example: 'REGION_PRIMARY_NURSE',
        },
        ttlMinutes: {type: 'integer', example: 15},
        ttlUnit: {
          type: 'string',
          enum: ['MINUTES', 'HOURS'],
          example: 'MINUTES',
        },
        channels: {
          type: 'array',
          items: {type: 'string', enum: ['IN_APP', 'EMAIL', 'SMS']},
          example: ['IN_APP', 'SMS'],
        },
      },
    },
  }),
};

const escalationPolicySchema = {
  type: 'object',
  properties: {
    flag: {type: 'string', enum: ['RED', 'YELLOW'], example: 'RED'},
    version: {
      type: 'integer',
      description: 'Increments on every change',
      example: 2,
    },
    steps: {
      type: 'array',
      description:
        'Ordered escalation steps: distinct types, ending with ADMIN (no timer).',
      items: escalationPolicyStepResponseSchema,
    },
    updatedAt: {type: 'string', format: 'date-time'},
    updatedBy: {
      type: 'string',
      nullable: true,
      description: 'User who saved this version; null for the system default',
    },
  },
};

module.exports = {
  '/api/v1/organizations/escalation-policies': {
    get: createSwaggerDocs({
      tags: ['Organizations'],
      summary: "Get current organization's escalation policies",
      description:
        "Retrieves the RED and YELLOW flag escalation policies (step order, timer per step, notify channels) for the caller's current active organization.",
      responses: {
        200: {
          description: 'Escalation policies retrieved successfully',
          message: {
            description: 'A message describing the result',
            example: 'Data retrieved successfully',
          },
          body: {
            description: 'One policy per flag color',
            type: 'object',
            properties: {
              escalationPolicies: {
                type: 'array',
                items: escalationPolicySchema,
              },
            },
          },
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Insufficient permissions',
        },
      },
    }),
  },

  '/api/v1/organizations/escalation-policies/{flag}': {
    put: createSwaggerDocs({
      tags: ['Organizations'],
      summary:
        "Update current organization's escalation policy for a flag color",
      description:
        'Replaces the escalation steps for one flag color by saving a new policy version. Flags already escalating keep the version they started on; only new escalations follow the change. Saving steps identical to the current version returns it unchanged. (Admin only)',
      parameters: [
        {
          name: 'flag',
          in: 'path',
          required: true,
          schema: {type: 'string', enum: ['RED', 'YELLOW']},
        },
      ],
      requestBody: {
        fields: {
          version: {
            type: 'integer',
            description:
              'The policy version being edited (from the GET). Rejected with 409 if a newer version has been saved since.',
            example: 2,
          },
          steps: {
            type: 'array',
            items: escalationPolicyStepSchema,
            example: [
              {
                type: 'PRIMARY_NURSE',
                ttlMinutes: 5,
                ttlUnit: 'MINUTES',
                channels: ['IN_APP', 'SMS'],
              },
              {
                type: 'CASE_MANAGER',
                ttlMinutes: 60,
                ttlUnit: 'HOURS',
                channels: ['IN_APP', 'EMAIL'],
              },
              {
                type: 'ADMIN',
                ttlMinutes: null,
                ttlUnit: null,
                channels: ['IN_APP', 'EMAIL', 'SMS'],
              },
            ],
          },
        },
        required: ['version', 'steps'],
      },
      responses: {
        200: {
          description: 'Escalation policy updated successfully',
          message: {
            description: 'A message describing the result',
            example: 'Data updated successfully',
          },
          body: {
            description: 'The policy now in effect for new escalations',
            type: 'object',
            properties: {
              escalationPolicy: escalationPolicySchema,
            },
          },
        },
        400: {
          description: 'Bad Request - Validation error',
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Insufficient permissions',
        },
        409: {
          description:
            'Conflict - The policy was changed since `version` was loaded; reload and retry',
        },
      },
    }),
  },

  '/api/v1/organizations/working-hours': {
    get: createSwaggerDocs({
      tags: ['Organizations'],
      summary: "Get current organization's working hours",
      description:
        "Retrieves the weekly working hours for the caller's current active organization.",
      responses: {
        200: {
          description: 'Working hours retrieved successfully',
          message: {
            description: 'A message describing the result',
            example: 'Data retrieved successfully',
          },
          body: {
            description: 'Weekly working hours',
            type: 'object',
            properties: {
              workingHours: workingHoursSchema,
            },
          },
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Insufficient permissions',
        },
        404: {
          description: 'Not Found - Organization not found',
        },
      },
    }),

    patch: createSwaggerDocs({
      tags: ['Organizations'],
      summary: "Update current organization's working hours",
      description:
        "Updates the weekly working hours for the caller's current active organization. Per-day replace — only the day keys included in the request body are overwritten; omitted days are left untouched. (Admin only)",
      requestBody: {
        fields: {
          workingHours: workingHoursSchema,
        },
        required: ['workingHours'],
      },
      responses: {
        200: {
          description: 'Working hours updated successfully',
          message: {
            description: 'A message describing the result',
            example: 'Data updated successfully',
          },
          body: {
            description: 'Weekly working hours after the update',
            type: 'object',
            properties: {
              workingHours: workingHoursSchema,
            },
          },
        },
        400: {
          description: 'Bad Request - Validation error',
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Insufficient permissions',
        },
        404: {
          description: 'Not Found - Organization not found',
        },
      },
    }),
  },

  '/api/v1/organizations/time-zone': {
    get: createSwaggerDocs({
      tags: ['Organizations'],
      summary: "Get current organization's time zone",
      description:
        "Retrieves the selected time zone for the caller's current active organization.",
      responses: {
        200: {
          description: 'Time zone retrieved successfully',
          message: {
            description: 'A message describing the result',
            example: 'Data retrieved successfully',
          },
          body: {
            description: "Organization's time zone",
            type: 'object',
            properties: {
              timeZone: timeZoneSchema,
            },
          },
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Insufficient permissions',
        },
        404: {
          description: 'Not Found - Organization not found',
        },
      },
    }),

    patch: createSwaggerDocs({
      tags: ['Organizations'],
      summary: "Update current organization's time zone",
      description:
        "Updates the selected time zone for the caller's current active organization. (Admin only)",
      requestBody: {
        fields: {
          timeZone: {
            type: 'string',
            description: 'One of the 6 supported USA time zone keys',
            example: 'EASTERN',
          },
        },
        required: ['timeZone'],
      },
      responses: {
        200: {
          description: 'Time zone updated successfully',
          message: {
            description: 'A message describing the result',
            example: 'Data updated successfully',
          },
          body: {
            description: "Organization's time zone after the update",
            type: 'object',
            properties: {
              timeZone: timeZoneSchema,
            },
          },
        },
        400: {
          description: 'Bad Request - Validation error',
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Insufficient permissions',
        },
        404: {
          description: 'Not Found - Organization not found',
        },
      },
    }),
  },
};
