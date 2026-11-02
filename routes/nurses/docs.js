const {
  createSwaggerDocs,
  createIdPathParam,
} = require('../../utils/swaggerUtils');

// Common nurse profile response schema
const nurseProfileSchema = {
  type: 'object',
  properties: {
    profileId: {
      type: 'string',
      description: 'Unique identifier of the nurse profile',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    nurseId: {
      type: 'string',
      description: 'User ID of the nurse',
      example: '550e8400-e29b-41d4-a716-446655440001',
    },
    organizationId: {
      type: 'string',
      description: 'Organization ID',
      example: '550e8400-e29b-41d4-a716-446655440002',
    },
    professionalRole: {
      type: 'string',
      enum: ['RN', 'LPN'],
      description: 'Professional role of the nurse',
      example: 'RN',
    },
    licenseNumber: {
      type: 'string',
      nullable: true,
      description:
        'Nursing license number. Null on an HHAeXchange-imported nurse the agency has not recorded one for.',
      example: 'RN123456',
    },
    licenseState: {
      type: 'string',
      description: 'State where license is issued',
      example: 'PA',
    },
    licenseExpirationDate: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description:
        'License expiration date. Null on an HHAeXchange-imported nurse until an admin fills it in -- HHAeXchange never publishes one.',
      example: '2027-12-31T00:00:00.000Z',
    },
    status: {
      type: 'string',
      enum: ['ACTIVE', 'INACTIVE'],
      description: 'Current status of the nurse',
      example: 'ACTIVE',
    },
    npi: {
      type: 'string',
      description: 'National Provider Identifier (optional)',
      example: '1234567890',
    },
    onCallIndicator: {
      type: 'boolean',
      description: 'Whether nurse is on-call',
      example: false,
    },
    preferredContactMethod: {
      type: 'string',
      description: 'Preferred method of contact',
      example: 'email',
    },
    notes: {
      type: 'string',
      description: 'Additional notes about the nurse',
      example: 'Specializes in pediatric care',
    },
    joiningDate: {
      type: 'string',
      format: 'date-time',
      description: 'Employment joining date',
      example: '2024-01-15T00:00:00.000Z',
    },
    primaryRegions: {
      type: 'array',
      description: 'Primary region assignments',
      items: {
        type: 'object',
        properties: {
          id: {type: 'string', example: '550e8400-e29b-41d4-a716-446655440003'},
          name: {type: 'string', example: 'Southeast Pennsylvania'},
          code: {type: 'string', example: 'SOUTHEAST_PENNSYLVANIA'},
        },
      },
    },
    secondaryRegions: {
      type: 'array',
      description: 'Secondary region assignments',
      items: {
        type: 'object',
        properties: {
          id: {type: 'string', example: '550e8400-e29b-41d4-a716-446655440004'},
          name: {type: 'string', example: 'Central Pennsylvania'},
          code: {type: 'string', example: 'CENTRAL_PENNSYLVANIA'},
        },
      },
    },
    currentPatientCount: {
      type: 'integer',
      description:
        'Computed number of patients currently assigned (calculated)',
      example: 15,
    },
    assignedAlerts: {
      type: 'integer',
      description:
        'ACTIVE escalations currently assigned to this nurse. List endpoint only (computed per page); omitted from single-nurse responses.',
      example: 3,
    },
    highAlerts: {
      type: 'integer',
      description:
        'Subset of assignedAlerts whose submission flag is RED. List endpoint only.',
      example: 1,
    },
    avgRespTimeSeconds: {
      type: 'integer',
      nullable: true,
      description:
        "All-time mean seconds from being paged (assignedAt) to resolving (endedAt) across this nurse's RESOLVED nurse-level escalation events. Null when the nurse has never resolved one. Raw seconds — the client formats and colors it. List endpoint only.",
      example: 245,
    },
    source: {
      type: 'string',
      enum: ['MANUAL', 'HHA_EXCHANGE'],
      example: 'MANUAL',
      description:
        'Where the record came from. On HHA_EXCHANGE the fields HHAeXchange owns (firstName, lastName, phoneNo, address, city, state, zipCode, professionalRole, status, licenseNumber, npi) are read-only and a PATCH touching one answers 400 HHA_MANAGED_FIELD_READ_ONLY. Primary regions follow isPrimaryRegionHhaManaged. licenseState, licenseExpirationDate, secondary regions, onCallIndicator, preferredContactMethod, notes and joiningDate stay editable.',
    },
    isPrimaryRegionHhaManaged: {
      type: 'boolean',
      example: false,
      description:
        "True while the HHAeXchange address resolves (ZIP -> county -> region). The sync then keeps that region as the nurse's only primary region and primaryRegionIds is read-only (400 HHA_MANAGED_FIELD_READ_ONLY). False when it cannot resolve, and an admin sets primary regions.",
    },
    hhaNurseId: {
      type: 'string',
      nullable: true,
      example: '4857985',
      description:
        'HHAeXchange NurseID. Null on MANUAL records. The same number identifies the person in the HHAeXchange caregiver feed.',
    },
    hhaLastSyncedAt: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description: 'When the HHAeXchange sync last reconciled this record.',
    },
    hhaModifiedDate: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description: "HHAeXchange's own ModifiedDate for the record.",
    },
    user: {
      type: 'object',
      description: 'User information',
      properties: {
        id: {type: 'string', example: '550e8400-e29b-41d4-a716-446655440001'},
        firstName: {type: 'string', example: 'Jane'},
        lastName: {type: 'string', example: 'Doe'},
        email: {type: 'string', example: 'jane.doe@hospital.com'},
        phoneNo: {type: 'string', example: '+1-555-123-4567'},
        address: {type: 'string', nullable: true, example: '45 Bergen Avenue'},
        city: {type: 'string', nullable: true, example: 'Jersey City'},
        state: {type: 'string', nullable: true, example: 'NJ'},
        zipCode: {type: 'string', nullable: true, example: '07305'},
        isVerified: {type: 'boolean'},
        isPlaceholderEmail: {
          type: 'boolean',
          description:
            'True while the email is still the synthetic @hhax.invalid one sync minted for an imported nurse HHAeXchange had no email for. It is the ONLY state in which email may be edited.',
        },
      },
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      description: 'Profile creation timestamp',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      description: 'Profile last update timestamp',
    },
  },
};

module.exports = {
  '/api/v1/nurses': {
    get: createSwaggerDocs({
      tags: ['Nurses'],
      summary: 'List all nurses in organization',
      description:
        'Retrieves a paginated list of nurses with optional filtering by status and region. Each nurse also carries per-page alert stats: assignedAlerts / highAlerts (their current ACTIVE escalation workload) and avgRespTimeSeconds (all-time average handling time).',
      parameters: [
        {
          in: 'query',
          name: 'status',
          schema: {type: 'string', enum: ['ACTIVE', 'INACTIVE', 'all']},
          description: 'Filter by nurse status',
          example: 'ACTIVE',
        },
        {
          in: 'query',
          name: 'regionId',
          schema: {type: 'string'},
          description: 'Filter by region ID',
          example: '550e8400-e29b-41d4-a716-446655440003',
        },
        {
          in: 'query',
          name: 'nurseRegionRole',
          schema: {type: 'string', enum: ['PRIMARY', 'SECONDARY']},
          description:
            'When combined with regionId, narrow results to nurses whose role for that region matches (used by the patient form to populate primary/secondary nurse pickers).',
          example: 'PRIMARY',
        },
        {
          in: 'query',
          name: 'isVerified',
          schema: {type: 'string', enum: ['true', 'false']},
          description: 'Filter by whether the linked user account is verified',
          example: 'true',
        },
        {
          in: 'query',
          name: 'search',
          schema: {type: 'string', maxLength: 200},
          description:
            'Filter by nurse name (case-insensitive). Each whitespace-separated token must match the user firstName or lastName, e.g. "jane do" matches "Jane Doe".',
          example: 'Jane',
        },
        {
          in: 'query',
          name: 'page',
          schema: {type: 'integer'},
          description: 'Page number for pagination',
          example: 1,
        },
        {
          in: 'query',
          name: 'limit',
          schema: {type: 'integer'},
          description: 'Number of results per page',
          example: 20,
        },
      ],
      responses: {
        200: {
          description: 'Nurses retrieved successfully',
          message: {
            description: 'A message describing the result',
            example: 'Nurses retrieved successfully',
          },
          body: {
            description: 'List of nurses',
            type: 'object',
            properties: {
              nurses: {
                type: 'array',
                items: nurseProfileSchema,
              },
              meta: {
                type: 'object',
                properties: {
                  page: {type: 'integer', example: 1},
                  limit: {type: 'integer', example: 20},
                  count: {type: 'integer', example: 5},
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

  '/api/v1/nurses/dashboard': {
    get: createSwaggerDocs({
      tags: ['Nurses'],
      summary: 'Get the dashboard for the logged-in nurse',
      description:
        'Returns the nurse dashboard scoped to patients in the caller’s ' +
        'regions: open RED and YELLOW flags, patients in their regions, ' +
        'assessment outcomes since the start of yesterday (UTC), and the ' +
        '"Due today" / "My day" follow-ups and supervisory visits. Due today ' +
        'and My day are dummy data until follow-ups and supervisory visits ' +
        'can be assigned to nurses. Nurses only (nurse.viewDashboard ' +
        'permission).',
      responses: {
        200: {
          description: 'Nurse dashboard retrieved successfully',
          message: {
            description: 'A message describing the result of the operation',
            example: 'Nurse dashboard retrieved successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              stats: {
                type: 'object',
                properties: {
                  openAlerts: {
                    type: 'object',
                    description: 'PENDING flags on patients in the regions',
                    properties: {
                      total: {type: 'integer', example: 7},
                      red: {type: 'integer', example: 2},
                      yellow: {type: 'integer', example: 5},
                    },
                  },
                  dueToday: {
                    type: 'object',
                    description: 'Dummy data for now',
                    properties: {
                      total: {type: 'integer', example: 4},
                      followUps: {type: 'integer', example: 3},
                      supervisoryVisits: {type: 'integer', example: 1},
                    },
                  },
                  myPatients: {
                    type: 'integer',
                    description: 'Patients in the nurse’s regions',
                    example: 38,
                  },
                },
              },
              myDay: {
                type: 'array',
                description: 'Dummy data for now',
                items: {
                  type: 'object',
                  properties: {
                    id: {type: 'string', example: 'dummy-follow-up-1'},
                    type: {
                      type: 'string',
                      enum: ['FOLLOW_UP', 'SUPERVISORY_VISIT'],
                      example: 'FOLLOW_UP',
                    },
                    title: {
                      type: 'string',
                      example: 'Call family about care plan update',
                    },
                    patientName: {type: 'string', example: 'Dorothy Kline'},
                    dueDate: {
                      type: 'string',
                      format: 'date-time',
                      example: '2026-09-17T00:00:00.000Z',
                    },
                    dueTime: {type: 'string', example: '10:00'},
                  },
                },
              },
              assessmentsSinceYesterday: {
                type: 'object',
                properties: {
                  submitted: {type: 'integer', example: 31},
                  missed: {type: 'integer', example: 3},
                  skipped: {type: 'integer', example: 2},
                },
              },
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'NURSE_DASHBOARD_RETRIEVED',
              },
            },
          },
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Nurses only'},
      },
    }),
  },

  '/api/v1/nurses/admin/stats': {
    get: createSwaggerDocs({
      tags: ['Nurses'],
      summary: 'Get org-wide nurse stats for the admin dashboard',
      description:
        'Returns organization-wide nurse metrics: total nurses, average ' +
        'number of alerts routed to nurses (escalation events assigned at a ' +
        'nurse stage divided by total nurses), and available nurses (ACTIVE ' +
        'status). All metrics are all-time by default and can be windowed ' +
        'with the optional from/to filter on createdAt. Admin only ' +
        '(nurse.viewAdminStats permission).',
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
          description: 'Nurse admin stats retrieved successfully',
          message: {
            description: 'A message describing the result of the operation',
            example: 'Nurse admin stats retrieved successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              stats: {
                type: 'object',
                description: 'Organization-wide nurse metrics',
                properties: {
                  totalNurses: {
                    type: 'integer',
                    description: 'Total nurses in the organization',
                    example: 16,
                  },
                  averageAlertsPerNurse: {
                    type: 'number',
                    description:
                      'Nurse-directed escalation alerts divided by total ' +
                      'nurses, rounded to 2 decimals (0 when there are no ' +
                      'nurses)',
                    example: 2.75,
                  },
                  availableNurses: {
                    type: 'integer',
                    description: 'Nurses with ACTIVE status',
                    example: 12,
                  },
                },
              },
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'NURSE_ADMIN_STATS_RETRIEVED',
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

  '/api/v1/nurses/{id}': {
    get: createSwaggerDocs({
      tags: ['Nurses'],
      summary: 'Get nurse profile details',
      description: 'Retrieves detailed information about a specific nurse',
      parameters: [
        createIdPathParam({name: 'id', description: 'Nurse profile ID'}),
      ],
      responses: {
        200: {
          description: 'Nurse retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Nurse retrieved successfully',
          },
          body: {
            description: 'Nurse profile details',
            type: 'object',
            properties: {
              nurse: nurseProfileSchema,
            },
          },
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        404: {
          description: 'Not Found - Nurse not found',
        },
      },
    }),

    patch: createSwaggerDocs({
      tags: ['Nurses'],
      summary: 'Update nurse profile',
      description:
        'Updates nurse profile information including professional details, address and region assignments. ' +
        'On a nurse with source HHA_EXCHANGE the fields HHAeXchange owns — firstName, lastName, phoneNo, address, city, state, zipCode, professionalRole, status, licenseNumber, npi — are read-only, because the nightly sync overwrites them; sending one answers 400 HHA_MANAGED_FIELD_READ_ONLY. ' +
        'While isPrimaryRegionHhaManaged is true, primaryRegionIds is read-only too, and secondaryRegionIds may not include the primary region (400 invalid region assignment). ' +
        'Email is accepted on an HHA_EXCHANGE record only while user.isPlaceholderEmail is true, which is the one correction path for an imported nurse HHAeXchange had no email for; anything else answers 400 HHA_MANAGED_FIELD_READ_ONLY. An address added later in HHAeXchange replaces it on the next sync. ' +
        'licenseNumber and licenseExpirationDate are optional here (an imported nurse may have neither yet); a given expiration date must still be in the future.',
      parameters: [
        createIdPathParam({name: 'id', description: 'Nurse profile ID'}),
      ],
      requestBody: {
        fields: {
          email: {
            type: 'string',
            description:
              'Login email. Accepted only while user.isPlaceholderEmail is true on an HHAeXchange-imported nurse.',
            example: 'jane.doe@hospital.com',
          },
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
            example: '+1-555-123-4567',
          },
          address: {
            type: 'string',
            description: 'Street address (stored on the user record)',
            example: '45 Bergen Avenue',
          },
          city: {type: 'string', description: 'City', example: 'Jersey City'},
          state: {type: 'string', description: 'State', example: 'NJ'},
          zipCode: {type: 'string', description: 'ZIP code', example: '07305'},
          professionalRole: {
            type: 'string',
            enum: ['RN', 'LPN'],
            description: 'Professional role',
            example: 'RN',
          },
          licenseNumber: {
            type: 'string',
            description: 'License number',
            example: 'RN123456',
          },
          licenseState: {
            type: 'string',
            description:
              'License state: any two-letter US state or territory code (default: PA)',
            example: 'PA',
          },
          licenseExpirationDate: {
            type: 'string',
            format: 'date',
            description: 'License expiration date',
            example: '2027-12-31',
          },
          status: {
            type: 'string',
            enum: ['ACTIVE', 'INACTIVE'],
            description: 'Nurse status',
            example: 'ACTIVE',
          },
          npi: {
            type: 'string',
            description: 'NPI number',
            example: '1234567890',
          },
          onCallIndicator: {
            type: 'boolean',
            description: 'On-call status',
            example: true,
          },
          preferredContactMethod: {
            type: 'string',
            description: 'Preferred contact method',
            example: 'phone',
          },
          notes: {
            type: 'string',
            description: 'Notes',
            example: 'Updated notes',
          },
          joiningDate: {
            type: 'string',
            format: 'date',
            description: 'Joining date',
            example: '2024-01-15',
          },
          primaryRegionIds: {
            type: 'array',
            description:
              'Full replacement list for the nurse primary-region role. Regions can move here from secondary assignments.',
            items: {type: 'string'},
            example: ['550e8400-e29b-41d4-a716-446655440003'],
          },
          secondaryRegionIds: {
            type: 'array',
            description:
              'Full replacement list for the nurse secondary-region role. Must not overlap with primaryRegionIds when both are provided.',
            items: {type: 'string'},
            example: ['550e8400-e29b-41d4-a716-446655440004'],
          },
        },
        required: [],
      },
      responses: {
        200: {
          description: 'Nurse updated successfully',
          message: {
            description: 'Success message',
            example: 'Nurse updated successfully',
          },
          body: {
            description: 'Updated nurse profile',
            type: 'object',
            properties: {
              nurse: nurseProfileSchema,
            },
          },
        },
        400: {
          description:
            'Bad Request - Validation error, or an HHAeXchange-managed field was edited (HHA_MANAGED_FIELD_READ_ONLY)',
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Insufficient permissions',
        },
        404: {
          description: 'Not Found - Nurse not found',
        },
      },
    }),

    delete: createSwaggerDocs({
      tags: ['Nurses'],
      summary: 'Delete nurse (soft delete)',
      description: 'Soft deletes a nurse profile from the organization',
      parameters: [
        createIdPathParam({name: 'id', description: 'Nurse profile ID'}),
      ],
      responses: {
        200: {
          description: 'Nurse deleted successfully',
          message: {
            description: 'Success message',
            example: 'Nurse deleted successfully',
          },
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Insufficient permissions',
        },
        404: {
          description: 'Not Found - Nurse not found',
        },
      },
    }),
  },
};
