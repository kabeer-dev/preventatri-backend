const {
  AUDIT_OPERATIONS_VALUES,
  AUDIT_LOGS_DEFAULT_RANGE_DAYS,
  AUDIT_LOGS_MAX_RANGE_DAYS,
  AUDIT_EXPORT_TYPE_VALUES,
  AUDIT_EXPORT_FORMAT_VALUES,
} = require('../../constants/auditConstants');

const {
  AUDIT_RESOURCE_TYPE_VALUES,
} = require('../../constants/requestLoggerConstants');
const {createSwaggerDocs} = require('../../utils/swaggerUtils');

// A single audit log entry, formatted as a detail card: a generated
// description, a before/after diff ("what changed"), the acting user with
// their role, and the request's origin (IP address, device, session,
// mobile/web). There is no separate single-log endpoint -- this list
// doubles as the detail view.
const auditLogSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'Unique identifier of the audit log entry',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    resourceType: {
      type: 'string',
      nullable: true,
      description: 'Stable resourceType key (see AUDIT_RESOURCE_TYPE_VALUES)',
      example: 'emergencyFlag',
    },
    resourceLabel: {
      type: 'string',
      nullable: true,
      description:
        'Entity-type label of the record (e.g. Patient, Emergency Flag)',
      example: 'Patient',
    },
    action: {
      type: 'string',
      enum: AUDIT_OPERATIONS_VALUES,
      description: 'The audited action',
      example: 'UPDATE',
    },
    description: {
      type: 'string',
      description:
        'Generated human-readable summary sentence: "<record name> <resource type> is <action> by <actor name>." for record-based actions (name resolved from the record\'s own before/after snapshot; falls back to "<Resource type> is <action> by <actor name>." when no name is found), or "<actor name> <action>." for self actions (login/logout/reset password/account lock/unlock), which omit the "by" clause since the actor and the record are the same person there.',
      example: 'Sharon Starke patient is updated by Jane Admin.',
    },
    timestamp: {
      type: 'string',
      format: 'date-time',
      description: 'When the action occurred',
    },
    whatChanged: {
      type: 'array',
      description:
        'What changed on the audited record. UPDATE lists one entry per changed field ("field" type, description "from → to"). Every other action (CREATE, READ, DELETE, LOGIN, INVITE, syncs, etc.) returns a single entry whose description is the same summary sentence as the top-level `description` field.',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['field', 'create', 'delete', 'no-change'],
          },
          title: {
            type: 'string',
            description:
              'The changed field\'s label for a "field" entry; a short event title otherwise.',
            example: 'Urination Normal',
          },
          description: {
            type: 'string',
            example: 'yes → no',
          },
        },
      },
    },
    actor: {
      type: 'object',
      properties: {
        id: {type: 'string', nullable: true},
        name: {type: 'string', nullable: true},
        role: {type: 'string', nullable: true, example: 'Caregiver'},
      },
    },
    origin: {
      type: 'object',
      properties: {
        ipAddress: {type: 'string', nullable: true},
        device: {
          type: 'string',
          nullable: true,
          example: 'iPhone 14 · iOS 18.2',
        },
        type: {type: 'string', nullable: true, example: 'Mobile app'},
      },
    },
  },
};

module.exports = {
  '/api/v1/audit-logs': {
    get: createSwaggerDocs({
      tags: ['Audit Logs'],
      summary: 'List audit logs, filterable by entity',
      description: `Retrieves audit logs scoped to the caller's active organization, filterable by entity type and id (e.g. a specific patient or red flag), action, actor, and a timestamp range. Ordered by timestamp descending. Admin only. resourceType, resourceId, action, and userId are all optional and independently combinable -- pass any subset (or none) and only the supplied filters narrow the results. fromDate/toDate default to the trailing ${AUDIT_LOGS_DEFAULT_RANGE_DAYS} days when omitted, and the fromDate/toDate window (defaulted or explicit) cannot exceed ${AUDIT_LOGS_MAX_RANGE_DAYS} days. Each row is returned as a full detail card (generated description, before/after diff, actor + role, request origin) -- there's no separate single-log endpoint.`,
      parameters: [
        {
          in: 'query',
          name: 'resourceType',
          required: false,
          schema: {type: 'string', enum: AUDIT_RESOURCE_TYPE_VALUES},
          description:
            'Entity type to filter by (mapped to the stored resource label). Optional -- omit to list across all entity types.',
          example: 'patient',
        },
        {
          in: 'query',
          name: 'resourceId',
          required: false,
          schema: {type: 'string', format: 'uuid'},
          description: 'UUID of a specific entity to filter by.',
          example: '550e8400-e29b-41d4-a716-446655440000',
        },
        {
          in: 'query',
          name: 'action',
          schema: {type: 'string', enum: AUDIT_OPERATIONS_VALUES},
          description: 'Filter by audited action.',
          example: 'UPDATE',
        },
        {
          in: 'query',
          name: 'userId',
          schema: {type: 'string', format: 'uuid'},
          description: 'Filter by the actor who performed the action.',
        },
        {
          in: 'query',
          name: 'fromDate',
          schema: {type: 'string', format: 'date-time'},
          description: `Start of the timestamp window (inclusive). Defaults to ${AUDIT_LOGS_DEFAULT_RANGE_DAYS} days before now when omitted. The fromDate/toDate window cannot exceed ${AUDIT_LOGS_MAX_RANGE_DAYS} days.`,
        },
        {
          in: 'query',
          name: 'toDate',
          schema: {type: 'string', format: 'date'},
          description: `End of the timestamp window (inclusive), as a calendar date -- the whole day is included. Defaults to now when omitted. The fromDate/toDate window cannot exceed ${AUDIT_LOGS_MAX_RANGE_DAYS} days.`,
        },
        {
          in: 'query',
          name: 'page',
          schema: {type: 'integer', minimum: 1, default: 1},
          description: 'Page number.',
        },
        {
          in: 'query',
          name: 'limit',
          schema: {type: 'integer', minimum: 1, maximum: 100, default: 10},
          description: 'Results per page.',
        },
      ],
      responses: {
        200: {
          description: 'Audit logs retrieved successfully',
          message: {
            description: 'A message describing the result',
            example: 'Audit logs retrieved successfully',
          },
          body: {
            description: 'List of audit logs',
            type: 'object',
            properties: {
              auditLogs: {
                type: 'array',
                items: auditLogSchema,
              },
              meta: {
                type: 'object',
                properties: {
                  page: {type: 'integer', example: 1},
                  limit: {type: 'integer', example: 10},
                  count: {type: 'integer', example: 42},
                  totalPages: {type: 'integer', example: 5},
                },
              },
              type: {type: 'string', example: 'AUDIT_LOGS_LISTED'},
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
          description: 'Forbidden - Caller is not an admin',
        },
      },
    }),
  },
  '/api/v1/audit-logs/exports': {
    post: createSwaggerDocs({
      tags: ['Audit Logs'],
      summary: 'Record a client-side data export in the audit log',
      description:
        'Exports (PDF/CSV/...) are generated in the browser, so the client reports each download here. Generic: any export screen sends its exportType. Requires the same permission as viewing the exported data (e.g. report.view for REPORT). Send only a description of what was exported (filters, record count), never the exported data itself.',
      requestBody: {
        fields: {
          exportType: {
            type: 'string',
            enum: AUDIT_EXPORT_TYPE_VALUES,
            description: 'What was exported',
            example: 'REPORT',
          },
          format: {
            type: 'string',
            enum: AUDIT_EXPORT_FORMAT_VALUES,
            description: 'File format that was downloaded',
            example: 'PDF',
          },
          title: {
            type: 'string',
            description: 'Human-readable title of the export',
            example: 'Reports, Jan 1 - Jan 31, All regions',
          },
          filters: {
            type: 'object',
            description:
              'Free-form description of the filters applied to the export',
            example: {from: '2026-01-01', to: '2026-01-31'},
          },
          recordCount: {
            type: 'integer',
            description: 'Number of records in the export, if known',
            example: 120,
          },
        },
        required: ['exportType', 'format'],
      },
      responses: {
        201: {
          description: 'Data export logged successfully',
          message: {
            description: 'A message describing the result',
            example: 'Data export logged successfully',
          },
          body: {
            description: 'Result',
            type: 'object',
            properties: {
              type: {type: 'string', example: 'DATA_EXPORT_LOGGED'},
            },
          },
        },
        400: {description: 'Bad request - Invalid body'},
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {
          description:
            'Forbidden - Caller cannot view the data for this exportType',
        },
      },
    }),
  },
};
