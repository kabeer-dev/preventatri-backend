const {
  PREFERRED_CONTACT_METHODS_VALUES,
} = require('../../constants/generalConstant');

const {
  createSwaggerDocs,
  createIdPathParam,
} = require('../../utils/swaggerUtils');

// User sub-schema
const userSchema = {
  type: 'object',
  properties: {
    id: {type: 'string'},
    firstName: {type: 'string', example: 'Sarah'},
    lastName: {type: 'string', example: 'Johnson'},
    email: {type: 'string', example: 'sarah.johnson@example.com'},
    phoneNo: {type: 'string', example: '+1234567890'},
    isVerified: {type: 'boolean'},
    isPlaceholderEmail: {
      type: 'boolean',
      description:
        'True while the address is still the synthetic @hhax.invalid one sync minted for an imported case manager HHAeXchange had no email for. It is the ONLY state in which email may be edited, and the UI uses this to enable the field.',
    },
  },
};

// Region sub-schema
const regionAssignmentSchema = {
  type: 'object',
  properties: {
    id: {type: 'string', description: 'Region ID'},
    name: {type: 'string', example: 'Southeast Pennsylvania'},
    code: {type: 'string', example: 'SOUTHEAST_PENNSYLVANIA'},
    assignedAt: {type: 'string', format: 'date-time'},
  },
};

// Patient assignment sub-schema
const patientAssignmentSchema = {
  type: 'object',
  properties: {
    id: {type: 'string', description: 'Patient ID'},
    firstName: {type: 'string', example: 'John'},
    lastName: {type: 'string', example: 'Doe'},
    source: {
      type: 'string',
      enum: ['MANUAL', 'HHA_EXCHANGE'],
      description:
        "The patient's source. An HHA_EXCHANGE patient's link comes from the patient sync (HHAeXchange's first coordinator) and cannot be changed here.",
    },
    assignedAt: {type: 'string', format: 'date-time'},
  },
};

// Case manager profile response schema
const caseManagerResponseSchema = {
  type: 'object',
  properties: {
    profileId: {type: 'string', description: 'Case manager profile ID'},
    caseManagerId: {type: 'string', description: 'User ID'},
    organizationId: {type: 'string'},
    status: {
      type: 'string',
      enum: ['ACTIVE', 'INACTIVE'],
      example: 'ACTIVE',
    },
    regions: {type: 'array', items: regionAssignmentSchema},
    patients: {
      type: 'array',
      items: patientAssignmentSchema,
      description: 'Patients directly assigned to this case manager',
    },
    assignedPatientsCount: {
      type: 'integer',
      example: 3,
      description: 'Number of patients currently assigned to this case manager',
    },
    source: {
      type: 'string',
      enum: ['MANUAL', 'HHA_EXCHANGE'],
      example: 'MANUAL',
      description:
        'Where the record came from. On HHA_EXCHANGE the fields HHAeXchange owns (firstName, lastName, status) are read-only and a PATCH touching one answers 400 HHA_MANAGED_FIELD_READ_ONLY. Title, phone, regions, manual patients, preferred contact method, language, start date and notes stay editable. Links to HHA_EXCHANGE patients come from the patient sync on every case manager and are read-only (see patients[].source).',
    },
    hhaCoordinatorId: {
      type: 'string',
      nullable: true,
      example: '4870049',
      description:
        'HHAeXchange CoordinatorID. Always set on an HHA_EXCHANGE record, always null on a MANUAL one (enforced by case_manager_profiles_hha_identity_check).',
    },
    hhaLastSyncedAt: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description:
        'When the sync last saw this record. There is deliberately no "modified date" counterpart as there is on caregivers: GetCoordinators publishes none, so this is the only timestamp HHAeXchange makes available for a case manager.',
    },
    user: userSchema,
    createdAt: {type: 'string', format: 'date-time'},
    updatedAt: {type: 'string', format: 'date-time'},
  },
};

module.exports = {
  '/api/v1/case-managers/available-patients': {
    get: createSwaggerDocs({
      tags: ['Case Managers'],
      summary: 'Get patients available for case manager assignment',
      description:
        'Returns MANUAL patients in the organization that are not yet assigned to any case manager. HHA_EXCHANGE patients are never listed: their case manager comes from the patient sync. Optionally filter by one or more region IDs (comma-separated). Admin only.',
      parameters: [
        {
          in: 'query',
          name: 'regionIds',
          schema: {type: 'string'},
          description:
            'Comma-separated region IDs to filter patients by region (e.g. "uuid1,uuid2")',
          example: '3f1a2b4c-...,7d8e9f0a-...',
          required: false,
        },
        {
          in: 'query',
          name: 'caseManagerProfileId',
          schema: {type: 'string', format: 'uuid'},
          description:
            'When editing a case manager, pass their profile ID to include their already-assigned patients in the results',
          required: false,
        },
      ],
      responses: {
        200: {
          description: 'Available patients retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Available patients retrieved successfully',
          },
          body: {
            description: 'List of available patients as label/value options',
            type: 'object',
            properties: {
              patients: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    value: {type: 'string', description: 'Patient ID'},
                    label: {
                      type: 'string',
                      example: 'John Doe',
                      description: 'Full name (firstName + lastName)',
                    },
                  },
                },
              },
            },
          },
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Insufficient permissions'},
      },
    }),
  },

  '/api/v1/case-managers/dashboard': {
    get: createSwaggerDocs({
      tags: ['Case Managers'],
      summary: 'Get the dashboard for the logged-in case manager',
      description:
        'Returns the dashboard scoped to the authenticated case manager: ' +
        'pending follow-up tasks and supervisory visits, assigned patients, ' +
        'the assessment rate over the last 30 days, and the nearest-due ' +
        'pending follow-ups and visits merged by due date. The assessment ' +
        'rate is resolved / (resolved + escalated to admin) for escalations ' +
        'assigned to them at the case manager level, or null when none ' +
        'ended in the window.',
      responses: {
        200: {
          description: 'Case manager dashboard retrieved successfully',
          message: {
            description: 'A message describing the result of the operation',
            example: 'Case manager dashboard retrieved successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              stats: {
                type: 'object',
                properties: {
                  tasksAssignedToMe: {
                    type: 'object',
                    properties: {
                      total: {type: 'integer', example: 7},
                      followUps: {type: 'integer', example: 5},
                      supervisoryVisits: {type: 'integer', example: 2},
                    },
                  },
                  myPatients: {type: 'integer', example: 14},
                  assessmentRate: {
                    type: 'integer',
                    nullable: true,
                    description: 'Percentage 0-100, null when no data',
                    example: 92,
                  },
                  assessmentRateCounts: {
                    type: 'object',
                    properties: {
                      resolved: {type: 'integer', example: 23},
                      skipped: {type: 'integer', example: 2},
                    },
                  },
                },
              },
              checklistTasks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: {type: 'string', format: 'uuid'},
                    type: {
                      type: 'string',
                      enum: ['FOLLOW_UP', 'SUPERVISORY_VISIT'],
                    },
                    dueDate: {type: 'string', format: 'date-time'},
                    flagType: {type: 'integer', nullable: true, example: 0},
                    checklistTitle: {
                      type: 'string',
                      nullable: true,
                      example: 'Care plan review',
                    },
                    patientName: {type: 'string', example: 'Dorothy Kline'},
                  },
                },
              },
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'CASE_MANAGER_DASHBOARD_RETRIEVED',
              },
            },
          },
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Case managers only'},
      },
    }),
  },

  '/api/v1/case-managers/admin/stats': {
    get: createSwaggerDocs({
      tags: ['Case Managers'],
      summary: 'Get org-wide case manager stats for the admin dashboard',
      description:
        'Returns organization-wide case manager metrics: total case ' +
        'managers, average cases per case manager (escalation events ' +
        'assigned at the case-manager stage divided by total case managers), ' +
        'and active case managers (ACTIVE status). All metrics are all-time ' +
        'by default and can be windowed with the optional from/to filter on ' +
        'createdAt. Admin only (caseManager.viewAdminStats permission).',
      parameters: [
        {
          in: 'query',
          name: 'from',
          schema: {type: 'string', format: 'date-time'},
          description:
            'Start of the createdAt window (inclusive). Omit for all time.',
          example: '2026-01-01T00:00:00.000Z',
        },
        {
          in: 'query',
          name: 'to',
          schema: {type: 'string', format: 'date-time'},
          description:
            'End of the createdAt window (inclusive). Must be on/after `from`. ' +
            'Omit for all time.',
          example: '2026-06-29T23:59:59.999Z',
        },
      ],
      responses: {
        200: {
          description: 'Case manager admin stats retrieved successfully',
          message: {
            description: 'A message describing the result of the operation',
            example: 'Case manager admin stats retrieved successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              stats: {
                type: 'object',
                description: 'Organization-wide case manager metrics',
                properties: {
                  totalCaseManagers: {
                    type: 'integer',
                    description: 'Total case managers in the organization',
                    example: 8,
                  },
                  averageCasesPerCaseManager: {
                    type: 'number',
                    description:
                      'Case-manager-directed escalation cases divided by ' +
                      'total case managers, rounded to 2 decimals (0 when ' +
                      'there are no case managers)',
                    example: 3.25,
                  },
                  activeCaseManagers: {
                    type: 'integer',
                    description: 'Case managers with ACTIVE status',
                    example: 6,
                  },
                },
              },
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'CASE_MANAGER_ADMIN_STATS_RETRIEVED',
              },
            },
          },
        },
        400: {
          description: 'Bad Request - Invalid from/to date filter',
          message: {
            description: 'Error message',
            example: 'to must be the same as or after from',
          },
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {
          description:
            'Forbidden - The user does not have access to this resource',
          message: {
            description: 'Error message',
            example: 'Forbidden - Access denied',
          },
        },
      },
    }),
  },

  '/api/v1/case-managers': {
    get: createSwaggerDocs({
      tags: ['Case Managers'],
      summary: 'List case managers in organization',
      description:
        'Retrieves a paginated list of case managers with their profiles and region assignments. Supports filtering by status and region.',
      parameters: [
        {
          in: 'query',
          name: 'page',
          schema: {type: 'integer'},
          description: 'Page number (default: 1)',
          example: 1,
        },
        {
          in: 'query',
          name: 'limit',
          schema: {type: 'integer'},
          description: 'Items per page (default: 25, max: 100)',
          example: 25,
        },
        {
          in: 'query',
          name: 'sortBy',
          schema: {
            type: 'string',
            enum: ['firstName', 'lastName', 'email', 'status', 'createdAt'],
          },
          description: 'Field to sort by',
          example: 'firstName',
        },
        {
          in: 'query',
          name: 'sortDir',
          schema: {type: 'string', enum: ['asc', 'desc']},
          description: 'Sort direction',
          example: 'asc',
        },
        {
          in: 'query',
          name: 'status',
          schema: {type: 'string', enum: ['ACTIVE', 'INACTIVE', 'all']},
          description: 'Filter by status',
        },
        {
          in: 'query',
          name: 'regionId',
          schema: {type: 'string', format: 'uuid'},
          description: 'Filter by region ID',
        },
        {
          in: 'query',
          name: 'isVerified',
          schema: {type: 'string', enum: ['true', 'false']},
          description:
            'Filter by whether the case manager accepted an invitation',
        },
        {
          in: 'query',
          name: 'search',
          schema: {type: 'string', maxLength: 200},
          description:
            'Filter by case manager name (case-insensitive). Each whitespace-separated token must match the user firstName or lastName, e.g. "sarah jo" matches "Sarah Johnson".',
          example: 'Sarah',
        },
      ],
      responses: {
        200: {
          description: 'Case managers list retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Case managers list retrieved successfully',
          },
          body: {
            description: 'List of case managers with pagination',
            type: 'object',
            properties: {
              caseManagers: {
                type: 'array',
                items: caseManagerResponseSchema,
              },
              meta: {
                type: 'object',
                properties: {
                  page: {type: 'integer', example: 1},
                  limit: {type: 'integer', example: 25},
                  count: {type: 'integer', example: 5},
                  totalPages: {type: 'integer', example: 1},
                },
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

  '/api/v1/case-managers/{id}': {
    get: createSwaggerDocs({
      tags: ['Case Managers'],
      summary: 'Get case manager profile details',
      description:
        'Retrieves detailed information about a specific case manager including user info and region assignments.',
      parameters: [
        createIdPathParam({
          name: 'id',
          description: 'Case manager profile ID',
        }),
      ],
      responses: {
        200: {
          description: 'Case manager profile retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Case manager profile retrieved successfully',
          },
          body: {
            description: 'Case manager profile details',
            type: 'object',
            properties: {
              caseManager: caseManagerResponseSchema,
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
          description: 'Not Found - Case manager not found',
        },
      },
    }),

    patch: createSwaggerDocs({
      tags: ['Case Managers'],
      summary: 'Update case manager profile',
      description:
        'Updates case manager user info and/or profile fields. At least one field must be provided. ' +
        'On a case manager with source HHA_EXCHANGE the fields HHAeXchange owns — firstName, lastName, status — are read-only, because the nightly sync overwrites them; sending one answers 400 HHA_MANAGED_FIELD_READ_ONLY. Title and regions are PreventaTri-owned and editable on every case manager. ' +
        'patientIds replaces the MANUAL patient roster only: links to HHA_EXCHANGE patients are kept whatever is sent, may be echoed back, and any other HHA_EXCHANGE patient id answers 400 HHA_MANAGED_FIELD_READ_ONLY. Changing regions never affects patient links. ' +
        'Email is accepted on an HHA_EXCHANGE record only while user.isPlaceholderEmail is true, which is the one correction path for an imported case manager HHAeXchange had no address for; anything else answers 400 HHA_MANAGED_FIELD_READ_ONLY. An address added later in HHAeXchange replaces it on the next sync. ',
      parameters: [
        createIdPathParam({
          name: 'id',
          description: 'Case manager profile ID',
        }),
      ],
      requestBody: {
        fields: {
          email: {
            type: 'string',
            description:
              'Login email. Accepted only while user.isPlaceholderEmail is true on an HHAeXchange-imported case manager.',
            example: 'sarah.johnson@example.com',
          },
          firstName: {
            type: 'string',
            description: 'First name. Read-only on an HHAeXchange record.',
            example: 'Sarah',
          },
          lastName: {
            type: 'string',
            description: 'Last name. Read-only on an HHAeXchange record.',
            example: 'Johnson',
          },
          phoneNo: {
            type: 'string',
            description:
              'Phone number. PreventaTri-owned and editable on every case manager, imported or not.',
            example: '+1234567890',
          },
          status: {
            type: 'string',
            enum: ['ACTIVE', 'INACTIVE'],
            description: 'Profile status. Read-only on an HHAeXchange record.',
          },
          title: {
            type: 'string',
            description:
              'Job title. PreventaTri-owned and editable on every case manager; the sync never writes it.',
          },
          preferredContactMethod: {
            type: 'string',
            enum: PREFERRED_CONTACT_METHODS_VALUES,
            nullable: true,
            description:
              'Preferred contact method. PreventaTri-owned and editable on every case manager.',
          },
          language: {
            type: 'string',
            nullable: true,
            description:
              'Language CODE, not a display name (VarChar(10)). PreventaTri-owned and editable on every case manager.',
            example: 'en',
          },
          startDate: {
            type: 'string',
            format: 'date',
            nullable: true,
            description:
              'Start date. PreventaTri-owned and editable on every case manager.',
          },
          notes: {
            type: 'string',
            nullable: true,
            description:
              'Internal notes. PreventaTri-owned and editable on every case manager.',
          },
          regionIds: {
            type: 'array',
            items: {type: 'string'},
            description:
              'Region IDs to assign, replacing the current set. PreventaTri-owned and editable on every case manager.',
          },
          patientIds: {
            type: 'array',
            items: {type: 'string'},
            description:
              'Patient IDs to assign, replacing the current set (unique). PreventaTri-owned and editable on every case manager.',
          },
        },
        required: [],
      },
      responses: {
        200: {
          description: 'Case manager profile updated successfully',
          message: {
            description: 'Success message',
            example: 'Case manager profile updated successfully',
          },
          body: {
            description: 'Updated case manager profile',
            type: 'object',
            properties: {
              caseManager: caseManagerResponseSchema,
            },
          },
        },
        400: {
          description:
            'Bad Request - At least one field must be provided, or an HHAeXchange-managed field was edited (HHA_MANAGED_FIELD_READ_ONLY)',
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Insufficient permissions',
        },
        404: {
          description: 'Not Found - Case manager not found',
        },
      },
    }),

    delete: createSwaggerDocs({
      tags: ['Case Managers'],
      summary: 'Delete case manager (soft delete)',
      description:
        'Soft deletes a case manager profile. The user account is preserved.',
      parameters: [
        createIdPathParam({
          name: 'id',
          description: 'Case manager profile ID',
        }),
      ],
      responses: {
        200: {
          description: 'Case manager deleted successfully',
          message: {
            description: 'Success message',
            example: 'Case manager profile deleted successfully',
          },
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Insufficient permissions',
        },
        404: {
          description: 'Not Found - Case manager not found',
        },
      },
    }),
  },
};
