const {
  CAREGIVER_SOURCES_VALUES,
  CAREGIVER_STATUSES_VALUES,
} = require('../../constants/caregiversConstants');

const {
  createSwaggerDocs,
  createIdPathParam,
} = require('../../utils/swaggerUtils');

// Derived from the constant rather than hand-listed: CaregiverStatus grew from
// two members to six with the HHAeXchange import, and four hard-coded copies of
// the old pair had already started documenting a status set that no longer
// existed. Adding a seventh status now updates the docs for free.
const CAREGIVER_STATUS_ENUM = CAREGIVER_STATUSES_VALUES;

const CAREGIVER_STATUS_FILTER_ENUM = [].concat(CAREGIVER_STATUSES_VALUES, [
  'all',
]);

// User sub-schema (shared across caregiver responses)
const userSchema = {
  type: 'object',
  properties: {
    id: {type: 'string'},
    firstName: {type: 'string', example: 'Jane'},
    lastName: {type: 'string', example: 'Doe'},
    email: {type: 'string', example: 'jane.doe@example.com'},
    phoneNo: {type: 'string', example: '+1234567890'},

    // Caregiver address lives on the user row -- CaregiverProfile is a User
    // satellite -- but it reads as a caregiver field to every caller.
    address: {type: 'string', example: '12 Elm St', nullable: true},
    city: {type: 'string', example: 'Erie', nullable: true},
    state: {type: 'string', example: 'PA', nullable: true},
    zipCode: {type: 'string', example: '16501', nullable: true},
    isVerified: {type: 'boolean'},
    isPlaceholderEmail: {
      type: 'boolean',
      description:
        'True when the email is still the synthetic @hhax.invalid address the HHAeXchange sync minted because HHAeXchange had none. Only while this is true may the email be changed.',
    },
  },
};

// Caregiver profile response schema
const caregiverResponseSchema = {
  type: 'object',
  properties: {
    profileId: {type: 'string', description: 'Caregiver profile ID'},
    caregiverId: {type: 'string', description: 'User ID'},
    organizationId: {type: 'string'},
    role: {
      type: 'string',
      example: 'PCA',
    },
    status: {
      type: 'string',
      enum: CAREGIVER_STATUS_ENUM,
      example: 'ACTIVE',
    },
    relationshipToPatient: {type: 'string', example: 'Spouse', nullable: true},
    language: {
      type: 'string',
      description:
        'Language CODE, not a display name — the column is VarChar(10). The HHAeXchange import resolves Language1 through GetLanguages and maps the name to a code.',
      example: 'es',
      nullable: true,
    },
    notes: {type: 'string', nullable: true},
    startDate: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description: 'Start with the agency. HHAeXchange HireDate on an import.',
    },
    terminationDate: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description: 'HHAeXchange TerminatedDate, when the caregiver has one.',
    },
    onCallIndicator: {type: 'boolean'},

    // HHAeXchange provenance. hhaSyncHash is never exposed — internal state.
    source: {
      type: 'string',
      enum: CAREGIVER_SOURCES_VALUES,
      description:
        'MANUAL for a caregiver invited here; HHA_EXCHANGE for one imported from HHAeXchange, whose managed fields are read-only.',
      example: 'MANUAL',
    },
    hhaCaregiverId: {
      type: 'string',
      nullable: true,
      description:
        'Permanent HHAeXchange CaregiverID. The only key the sync matches on.',
    },
    hhaLastSyncedAt: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description: 'When a sync run last saw this caregiver in the feed.',
    },
    hhaModifiedDate: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description:
        "HHAeXchange's own ModifiedDate for the record, as of the last run that found a real change.",
    },
    assignedPatientCount: {
      type: 'integer',
      description:
        'Number of assigned patients via checklist assignments (excludes soft-deleted patients)',
      example: 2,
    },
    redFlagCount: {
      type: 'integer',
      description:
        'Total number of red flags submitted by this caregiver (excludes soft-deleted)',
      example: 3,
    },
    user: userSchema,
    createdAt: {type: 'string', format: 'date-time'},
    updatedAt: {type: 'string', format: 'date-time'},
  },
};

module.exports = {
  '/api/v1/caregivers': {
    get: createSwaggerDocs({
      tags: ['Caregivers'],
      summary: 'List caregivers in organization',
      description:
        'Retrieves a paginated list of caregivers with their profiles and patient assignments. Supports filtering by status and role label.',
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
          schema: {type: 'string', enum: CAREGIVER_STATUS_FILTER_ENUM},
          description: 'Filter by status',
        },
        {
          in: 'query',
          name: 'role',
          schema: {
            type: 'string',
          },
          description: 'Filter by role',
        },
        {
          in: 'query',
          name: 'search',
          schema: {type: 'string', maxLength: 200},
          description:
            'Filter by caregiver name (case-insensitive). Each whitespace-separated token must match the user firstName or lastName, e.g. "jane do" matches "Jane Doe".',
          example: 'Jane',
        },
      ],
      responses: {
        200: {
          description: 'Caregivers list retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Caregivers list retrieved successfully',
          },
          body: {
            description: 'List of caregivers with pagination',
            type: 'object',
            properties: {
              caregivers: {
                type: 'array',
                items: caregiverResponseSchema,
              },
              meta: {
                type: 'object',
                properties: {
                  page: {type: 'integer', example: 1},
                  limit: {type: 'integer', example: 25},
                  count: {type: 'integer', example: 10},
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

  '/api/v1/caregivers/stats': {
    get: createSwaggerDocs({
      tags: ['Caregivers'],
      summary: 'Get dashboard stats for the logged-in caregiver',
      description:
        'Returns dashboard metrics scoped to the authenticated caregiver: ' +
        'patients assigned to them, assessments due (UPCOMING/PENDING/LATE) ' +
        'and completed (SUBMITTED/REVIEWED), flags they submitted, and pending ' +
        'follow-up tasks on their patients. Self-scoped to the caller; callers ' +
        'who are not caregivers receive 0 for the profile-scoped metrics. ' +
        'Accepts an optional from/to date range (each metric is filtered on its ' +
        'own date column) and defaults to all-time when omitted.',
      parameters: [
        {
          in: 'query',
          name: 'from',
          schema: {type: 'string', format: 'date-time'},
          required: false,
          description:
            'Start of the date range (inclusive). Omit for no lower bound.',
          example: '2026-06-01T00:00:00.000Z',
        },
        {
          in: 'query',
          name: 'to',
          schema: {type: 'string', format: 'date-time'},
          required: false,
          description:
            'End of the date range (inclusive). Must be the same as or after ' +
            '`from`. Omit for no upper bound.',
          example: '2026-06-30T23:59:59.999Z',
        },
      ],
      responses: {
        200: {
          description: 'Caregiver stats retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Caregiver stats retrieved successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              stats: {
                type: 'object',
                description: 'Dashboard metrics for the logged-in caregiver',
                properties: {
                  assignedPatients: {
                    type: 'integer',
                    description: 'Total patients assigned to this caregiver',
                    example: 8,
                  },
                  assessmentsDue: {
                    type: 'integer',
                    description:
                      'Assessments awaiting the caregiver (UPCOMING, PENDING ' +
                      'or LATE)',
                    example: 5,
                  },
                  assessmentsCompleted: {
                    type: 'integer',
                    description:
                      'Assessments the caregiver has completed (SUBMITTED or ' +
                      'REVIEWED)',
                    example: 23,
                  },
                  submittedFlags: {
                    type: 'integer',
                    description: 'Flags submitted by this caregiver',
                    example: 4,
                  },

                  // Temporarily disabled — the followUpTasks metric is
                  // commented out in caregiversServices, so it is omitted from
                  // the documented response shape until it is re-enabled.
                  // followUpTasks: {
                  //   type: 'integer',
                  //   description:
                  //     'Pending follow-up tasks on this caregiver’s patients',
                  //   example: 2,
                  // },
                },
              },
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'CAREGIVER_STATS_RETRIEVED',
              },
            },
          },
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
      },
    }),
  },

  '/api/v1/caregivers/admin/stats': {
    get: createSwaggerDocs({
      tags: ['Caregivers'],
      summary: 'Get org-wide caregiver stats for the admin dashboard',
      description:
        'Returns organization-wide caregiver counts: total caregivers, ' +
        'active caregivers (ACTIVE status) and inactive caregivers (INACTIVE ' +
        'status). All counts are all-time by default and can be windowed ' +
        'with the optional from/to filter on createdAt. Admin only ' +
        '(caregiver.viewAdminStats permission).',
      parameters: [
        {
          in: 'query',
          name: 'from',
          schema: {type: 'string', format: 'date-time'},
          required: false,
          description:
            'Start of the createdAt window (inclusive). Omit for all time.',
          example: '2026-01-01T00:00:00.000Z',
        },
        {
          in: 'query',
          name: 'to',
          schema: {type: 'string', format: 'date-time'},
          required: false,
          description:
            'End of the createdAt window (inclusive). Must be the same as or ' +
            'after `from`. Omit for all time.',
          example: '2026-06-30T23:59:59.999Z',
        },
      ],
      responses: {
        200: {
          description: 'Caregiver admin stats retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Caregiver admin stats retrieved successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              stats: {
                type: 'object',
                description: 'Organization-wide caregiver counts',
                properties: {
                  totalCaregivers: {
                    type: 'integer',
                    description: 'Total caregivers in the organization',
                    example: 42,
                  },
                  activeCaregivers: {
                    type: 'integer',
                    description: 'Caregivers with ACTIVE status',
                    example: 35,
                  },
                  inactiveCaregivers: {
                    type: 'integer',
                    description: 'Caregivers with INACTIVE status',
                    example: 7,
                  },
                  holdCaregivers: {
                    type: 'integer',
                    description: 'Caregivers with HOLD status',
                    example: 2,
                  },
                  onLeaveCaregivers: {
                    type: 'integer',
                    description: 'Caregivers with ON_LEAVE status',
                    example: 1,
                  },
                  terminatedCaregivers: {
                    type: 'integer',
                    description: 'Caregivers with TERMINATED status',
                    example: 3,
                  },
                  rejectedCaregivers: {
                    type: 'integer',
                    description: 'Caregivers with REJECTED status',
                    example: 1,
                  },
                },
              },
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'CAREGIVER_ADMIN_STATS_RETRIEVED',
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

  '/api/v1/caregivers/{id}/statistics': {
    get: createSwaggerDocs({
      tags: ['Caregivers'],
      summary: 'Get caregiver statistics',
      description:
        'Retrieves statistics for a specific caregiver including the number of submissions (with status SUBMITTED) and red flags in the last 30 days.',
      parameters: [
        createIdPathParam({name: 'id', description: 'Caregiver profile ID'}),
      ],
      responses: {
        200: {
          description: 'Caregiver statistics retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Caregiver statistics retrieved successfully',
          },
          body: {
            description: 'Caregiver statistics',
            type: 'object',
            properties: {
              statistics: {
                type: 'object',
                properties: {
                  submissionsCount: {
                    type: 'integer',
                    description:
                      'Number of submissions with status SUBMITTED in the last 30 days',
                    example: 12,
                  },
                  redFlagsCount: {
                    type: 'integer',
                    description: 'Number of red flags in the last 30 days',
                    example: 3,
                  },
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
        404: {
          description: 'Not Found - Caregiver not found',
        },
      },
    }),
  },

  '/api/v1/caregivers/{id}': {
    get: createSwaggerDocs({
      tags: ['Caregivers'],
      summary: 'Get caregiver profile details',
      description:
        'Retrieves detailed information about a specific caregiver including user info and patient assignments.',
      parameters: [
        createIdPathParam({name: 'id', description: 'Caregiver profile ID'}),
      ],
      responses: {
        200: {
          description: 'Caregiver profile retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Caregiver profile retrieved successfully',
          },
          body: {
            description: 'Caregiver profile details',
            type: 'object',
            properties: {
              caregiver: caregiverResponseSchema,
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
          description: 'Not Found - Caregiver not found',
        },
      },
    }),

    patch: createSwaggerDocs({
      tags: ['Caregivers'],
      summary: 'Update caregiver profile',
      description:
        'Updates caregiver user info and/or profile fields. At least one field must be provided.',
      parameters: [
        createIdPathParam({name: 'id', description: 'Caregiver profile ID'}),
      ],
      requestBody: {
        fields: {
          firstName: {
            type: 'string',
            description: 'First name',
            example: 'Jane',
          },
          lastName: {
            type: 'string',
            description: 'Last name',
            example: 'Doe',
          },
          phoneNo: {
            type: 'string',
            description: 'Phone number',
            example: '+1234567890',
          },
          role: {
            type: 'string',
            description: 'Caregiver role',
          },
          status: {
            type: 'string',
            enum: CAREGIVER_STATUS_ENUM,
            description: 'Profile status',
          },
          relationshipToPatient: {
            type: 'string',
            description: 'Relationship to patient',
          },
          language: {
            type: 'string',
            description: 'Preferred language',
          },
          notes: {
            type: 'string',
            description: 'Additional notes',
          },
          startDate: {
            type: 'string',
            format: 'date',
            description: 'Start date',
          },
          terminationDate: {
            type: 'string',
            format: 'date',
            description: 'Termination date',
          },
        },
        required: [],
      },
      responses: {
        200: {
          description: 'Caregiver profile updated successfully',
          message: {
            description: 'Success message',
            example: 'Caregiver profile updated successfully',
          },
          body: {
            description: 'Updated caregiver profile',
            type: 'object',
            properties: {
              caregiver: caregiverResponseSchema,
            },
          },
        },
        400: {
          description: 'Bad Request - At least one field must be provided',
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Insufficient permissions',
        },
        404: {
          description: 'Not Found - Caregiver not found',
        },
      },
    }),

    delete: createSwaggerDocs({
      tags: ['Caregivers'],
      summary: 'Delete caregiver (soft delete)',
      description:
        'Soft deletes a caregiver profile. The user account is preserved. Cannot delete a caregiver that has active assignments.',
      parameters: [
        createIdPathParam({name: 'id', description: 'Caregiver profile ID'}),
      ],
      responses: {
        200: {
          description: 'Caregiver deleted successfully',
          message: {
            description: 'Success message',
            example: 'Caregiver profile deleted successfully',
          },
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Insufficient permissions',
        },
        404: {
          description: 'Not Found - Caregiver not found',
        },
        409: {
          description:
            'Conflict - Cannot delete caregiver that has active assignments',
        },
      },
    }),
  },
};
