const {
  ESCALATION_LEVELS_VALUES,
  ESCALATION_STATUSES_VALUES,
  ESCALATION_RESPONSE_ACTIONS_VALUES,
} = require('../../constants/escalationConstants');
const {RED_FLAG_REASONS_VALUES} = require('../../constants/redFlagConstants');

const {
  createSwaggerDocs,
  createIdPathParam,
} = require('../../utils/swaggerUtils');

// File object sub-schema (reusable for images and audio)
const fileObjectSchema = {
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description:
        'Presigned S3 file URL. Expires with the session window after the response is generated - refetch to get a new one.',
    },
    key: {type: 'string', description: 'S3 file key'},
  },
};

// Submitter sub-schema (list endpoints)
const submitterSchema = {
  type: 'object',
  properties: {
    id: {type: 'string'},
    firstName: {type: 'string', example: 'Jane'},
    lastName: {type: 'string', example: 'Doe'},
  },
};

// Expanded person sub-schema (get-by-id)
const personDetailsSchema = {
  type: 'object',
  properties: {
    firstName: {type: 'string', example: 'Jane'},
    lastName: {type: 'string', example: 'Doe'},
    email: {type: 'string', nullable: true, example: 'jane.doe@example.com'},
    address: {type: 'string', nullable: true, example: '123 Main St'},
    phoneNo: {type: 'string', nullable: true, example: '+1234567890'},
  },
};

// Name-only reference to a nurse, case manager or caregiver on the care team.
const careTeamMemberSchema = {
  type: 'object',
  nullable: true,
  properties: {
    id: {type: 'string', description: 'Profile ID'},
    user: {
      type: 'object',
      nullable: true,
      properties: {
        firstName: {type: 'string', example: 'Jane'},
        lastName: {type: 'string', example: 'Doe'},
      },
    },
  },
};

// Patient sub-schema (get-by-id): contact details plus the record facts and
// care team the alert review page shows beside the flag.
const patientDetailsSchema = {
  type: 'object',
  properties: {
    firstName: {type: 'string', example: 'Jane'},
    lastName: {type: 'string', example: 'Doe'},
    email: {type: 'string', nullable: true, example: 'jane.doe@example.com'},
    address: {type: 'string', nullable: true, example: '123 Main St'},
    phoneNo: {type: 'string', nullable: true, example: '+1234567890'},
    city: {type: 'string', nullable: true, example: 'Pittsburgh'},
    dateOfBirth: {type: 'string', format: 'date-time'},
    medicaidId: {type: 'string', nullable: true},
    diagnoses: {type: 'string', nullable: true},
    emergencyContact: {type: 'string', nullable: true, example: '+1234567890'},
    primaryNurse: careTeamMemberSchema,
    secondaryNurse: careTeamMemberSchema,
    caseManager: careTeamMemberSchema,
    assignedCaregivers: {type: 'array', items: careTeamMemberSchema},
  },
};

// A single entry in the timeline, ordered oldest-first by `at`.
const timelineEntrySchema = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: [
        'STARTED',
        'ASSIGNED',
        'ESCALATED',
        'EXPIRED',
        'RESOLVED',
        'VOIDED',
      ],
      description: 'What happened at this step',
    },
    at: {type: 'string', format: 'date-time'},
    level: {
      type: 'string',
      nullable: true,
      enum: ESCALATION_LEVELS_VALUES,
      description:
        'Escalation level of the step; null for STARTED, RESOLVED and VOIDED',
      example: 'PATIENT_PRIMARY_NURSE',
    },
    user: {
      type: 'object',
      nullable: true,
      description:
        'Who the entry is about: submitter (STARTED), assignee (ASSIGNED/ESCALATED/EXPIRED), resolver (RESOLVED) or voider (VOIDED)',
      properties: {
        firstName: {type: 'string', nullable: true, example: 'Fletcher'},
        lastName: {type: 'string', nullable: true, example: 'Henry'},
      },
    },
    notes: {
      type: 'string',
      nullable: true,
      description: 'Resolution notes (RESOLVED) or void reason (VOIDED)',
    },
  },
};

// The assignee's resolution of the escalation. Returned as the top-level
// `response` field on the detail endpoint; null until the flag is resolved.
const escalationResolutionSchema = {
  type: 'object',
  nullable: true,
  description: "The assignee's resolution; null until the flag is resolved",
  properties: {
    id: {type: 'string'},
    actions: {
      type: 'array',
      items: {
        type: 'integer',
        enum: ESCALATION_RESPONSE_ACTIONS_VALUES,
      },
      description:
        'Action codes taken at resolution (0=Guided Caregiver on Call, 1=Guided Patient on Call, 2=Sent Instructions to Caregiver and Patient, 3=Team Dispatched)',
    },
    notes: {type: 'string', nullable: true, description: 'Free-text notes'},
    attachments: {
      type: 'array',
      items: fileObjectSchema,
      description: 'Resolution attachments (images, PDF, or Word documents)',
    },
    hasFollowUp: {type: 'boolean'},
    followUpDate: {type: 'string', format: 'date-time', nullable: true},
    followUpDescription: {type: 'string', nullable: true},
    hasSupervisoryVisit: {type: 'boolean'},
    supervisoryVisitDate: {type: 'string', format: 'date-time', nullable: true},
    supervisoryInstructions: {type: 'string', nullable: true},
    submitter: {
      type: 'object',
      nullable: true,
      description: 'User who recorded the resolution',
      properties: {
        firstName: {type: 'string', nullable: true, example: 'Admin'},
        lastName: {type: 'string', nullable: true, example: 'Desolint'},
      },
    },
    createdAt: {type: 'string', format: 'date-time'},
  },
};

// Emergency flag response schema
const emergencyFlagResponseSchema = {
  type: 'object',
  properties: {
    id: {type: 'string', description: 'Emergency flag ID'},
    status: {
      type: 'string',
      enum: ESCALATION_STATUSES_VALUES,
      description:
        'Current condition of the flag. On the detail endpoint this reflects VOIDED (flag-level) or the live escalation status; ACTIVE by default.',
      example: 'RESOLVED',
    },
    flag: {
      type: 'string',
      enum: ['GREEN', 'YELLOW', 'RED'],
      description:
        'Flag colour. The frontend maps this raw value to its colour indicator.',
      example: 'RED',
    },
    reason: {
      type: 'integer',
      enum: RED_FLAG_REASONS_VALUES,
      description:
        'Emergency flag reason code (0=Fall or Injury, 1=Sudden Health Decline, 2=Unresponsive, 3=Severe Pain, 4=Difficulty Breathing, 5=Medication Issue, 6=Other, 7=Auto-submission Flag)',
      example: 0,
    },
    description: {
      type: 'string',
      description: 'Detailed description',
      example: 'Patient fell in the bathroom and is unable to stand up',
    },
    images: {
      type: 'array',
      items: fileObjectSchema,
      description: 'Up to 5 images',
    },
    audioNote: {
      // eslint-disable-next-line local-rules/no-spread-operator
      ...fileObjectSchema,
      nullable: true,
      description: 'Audio note recording',
    },
    patientId: {type: 'string', description: 'Patient ID'},
    patient: {
      type: 'object',
      properties: {
        id: {type: 'string'},
        firstName: {type: 'string', example: 'John'},
        lastName: {type: 'string', example: 'Smith'},
      },
    },
    organizationId: {type: 'string'},
    submittedBy: {type: 'string', description: 'Submitter user ID'},
    submitter: submitterSchema,
    voidReason: {
      type: 'string',
      nullable: true,
      description: 'Reason for voiding the emergency flag (set by admin)',
      example: 'Reported in error - patient was not in danger',
    },
    voidedAt: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description: 'Timestamp when the emergency flag was voided',
    },
    createdAt: {type: 'string', format: 'date-time'},
    updatedAt: {type: 'string', format: 'date-time'},
  },
};

// Pagination meta schema
const paginationMeta = {
  type: 'object',
  properties: {
    page: {type: 'integer', example: 1},
    limit: {type: 'integer', example: 25},
    count: {type: 'integer', example: 10},
    totalPages: {type: 'integer', example: 1},
  },
};

// Next-assigned flag object (my-escalations inbox). Shape produced by
// formatFirstAssignedFlag — a single next escalation plus the caller's remaining
// per-color counts. Null when the caller has no active assigned escalation.
const assignedFlagSchema = {
  type: 'object',
  nullable: true,
  properties: {
    id: {type: 'string', description: 'Escalation ID'},
    flagType: {
      type: 'string',
      nullable: true,
      description: 'Flag color, lowercased (e.g. "red", "yellow")',
      example: 'red',
    },
    reason: {
      type: 'string',
      nullable: true,
      description: 'Human-readable reason label',
      example: 'Severe Pain',
    },
    description: {
      type: 'string',
      nullable: true,
      example: 'Patient reported severe chest pain',
    },
    patientId: {
      type: 'string',
      nullable: true,
      description: 'Patient ID the escalation belongs to',
    },
    patientName: {
      type: 'string',
      nullable: true,
      description: "Patient's full name",
      example: 'John Smith',
    },
    caregiverName: {
      type: 'string',
      nullable: true,
      description: "Submitting caregiver's full name",
      example: 'Jane Doe',
    },
    remainingRedFlags: {
      type: 'integer',
      description:
        'Remaining active RED escalations assigned to the caller (excluding the one surfaced)',
      example: 2,
    },
    remainingYellowFlags: {
      type: 'integer',
      description:
        'Remaining active YELLOW escalations assigned to the caller (excluding the one surfaced)',
      example: 1,
    },
  },
};

module.exports = {
  '/api/v1/assessments/emergency-flags': {
    post: createSwaggerDocs({
      tags: ['Emergency Flags'],
      summary: 'Create an emergency flag',
      description:
        'Submits a new emergency flag report. Only caregivers can create emergency flags. Supports up to 5 image uploads and 1 audio note via multipart/form-data.',
      requestBody: {
        contentType: 'multipart/form-data',
        fields: {
          reason: {
            type: 'integer',
            enum: RED_FLAG_REASONS_VALUES,
            description: 'Emergency flag reason code',
            example: 0,
          },
          description: {
            type: 'string',
            description: 'Detailed description of the emergency flag',
            example: 'Patient fell in the bathroom and is unable to stand up',
          },
          patientId: {
            type: 'string',
            description: 'Patient ID this emergency flag is for',
          },
          images: {
            type: 'array',
            items: {type: 'string', format: 'binary'},
            description: 'Image files (up to 5, max 5MB each)',
          },
          audioNote: {
            type: 'string',
            format: 'binary',
            description: 'Audio note file (max 10MB)',
          },
        },
        required: ['reason', 'description', 'patientId'],
      },
      responses: {
        201: {
          description: 'Emergency flag created successfully',
          message: {
            description: 'Success message',
            example: 'Emergency flag created successfully',
          },
          body: {
            description: 'Created emergency flag',
            type: 'object',
            properties: {
              emergencyFlag: emergencyFlagResponseSchema,
            },
          },
        },
        400: {
          description: 'Bad Request - Validation error or max images exceeded',
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Only caregivers can create emergency flags',
        },
      },
    }),

    get: createSwaggerDocs({
      tags: ['Emergency Flags'],
      summary: 'List emergency flags',
      description:
        'Retrieves a paginated list of emergency flags (YELLOW and RED by default; GREEN flags are excluded from this endpoint). Caregivers only see their own emergency flags. Supports filtering by patient, caregiver and flag colour. All authenticated roles can view.',
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
          schema: {type: 'string', enum: ['createdAt', 'reason']},
          description: 'Field to sort by',
          example: 'createdAt',
        },
        {
          in: 'query',
          name: 'sortDir',
          schema: {type: 'string', enum: ['asc', 'desc']},
          description: 'Sort direction',
          example: 'desc',
        },
        {
          in: 'query',
          name: 'patientId',
          schema: {type: 'string', format: 'uuid'},
          description: 'Filter by patient ID',
        },
        {
          in: 'query',
          name: 'submittedBy',
          schema: {type: 'string', format: 'uuid'},
          description:
            'Filter by caregiver user ID. Ignored for caregivers (auto-scoped to own submissions)',
        },
        {
          in: 'query',
          name: 'flag',
          schema: {type: 'string', enum: ['YELLOW', 'RED']},
          description:
            'Filter by flag colour. Omit to return both YELLOW and RED. GREEN is not accepted.',
        },
        {
          in: 'query',
          name: 'search',
          schema: {type: 'string'},
          description:
            'Case-insensitive search across patient and caregiver (submitter) first and last names',
        },
        {
          in: 'query',
          name: 'regionId',
          schema: {type: 'string'},
          description:
            "Comma-separated region UUIDs. Matches flags whose patient's county is in one of the regions.",
        },
      ],
      responses: {
        200: {
          description: 'Emergency flags list retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Emergency flags list retrieved successfully',
          },
          body: {
            description: 'List of emergency flags with pagination',
            type: 'object',
            properties: {
              emergencyFlags: {
                type: 'array',
                items: emergencyFlagResponseSchema,
              },
              meta: paginationMeta,
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

  '/api/v1/assessments/escalations/assigned': {
    get: createSwaggerDocs({
      tags: ['Emergency Flags'],
      summary: 'Get my next assigned escalation',
      description:
        "Returns the authenticated user's next ACTIVE assigned escalation by priority (oldest RED, otherwise oldest YELLOW) as a single `flag` object, plus the remaining per-color counts. Self-scoped: only escalations whose current assignee matches the caller are considered. `flag` is null when the caller has no active assigned escalation. Optionally filter by flag type via the `type` query param.",
      parameters: [
        {
          in: 'query',
          name: 'type',
          schema: {type: 'string', enum: ['RED', 'YELLOW']},
          description:
            'Filter by flag type. Accepted values are RED or YELLOW (case-insensitive). When omitted, returns the next assigned escalation across both types by priority.',
          example: 'RED',
        },
        {
          in: 'query',
          name: 'patientId',
          schema: {type: 'string', format: 'uuid'},
          description:
            'Only consider escalations for this patient. The surfaced flag and the remaining counts are then scoped to that patient.',
        },
      ],
      responses: {
        200: {
          description: 'Assigned flag retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Assigned flag retrieved successfully',
          },
          body: {
            description:
              'The next assigned flag (or null) with remaining per-color counts',
            type: 'object',
            properties: {
              flag: assignedFlagSchema,
            },
          },
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
      },
    }),
  },

  '/api/v1/assessments/emergency-flags/{id}': {
    get: createSwaggerDocs({
      tags: ['Emergency Flags'],
      summary: 'Get emergency flag details',
      description:
        'Retrieves detailed information about a specific emergency flag including full patient and caregiver details (name, email, address, phone), the patient record facts (date of birth, Medicaid ID, diagnoses, emergency contact, care team) and the escalation record — the full timeline of escalation events and, once resolved, the resolution. All authenticated roles can view.',
      parameters: [
        createIdPathParam({name: 'id', description: 'Emergency flag ID'}),
      ],
      responses: {
        200: {
          description: 'Emergency flag retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Emergency flag retrieved successfully',
          },
          body: {
            description: 'Emergency flag details',
            type: 'object',
            properties: {
              emergencyFlag: {
                allOf: [
                  emergencyFlagResponseSchema,
                  {
                    properties: {
                      patient: patientDetailsSchema,
                      submitter: personDetailsSchema,
                      timeline: {
                        type: 'array',
                        description:
                          'Chronological timeline, oldest-first: STARTED, ASSIGNED (who it went to), ESCALATED/EXPIRED (when an assignee passed it on or timed out), RESOLVED (who resolved it, with notes) and VOIDED (with reason). Assignment/escalation entries are scoped to the levels the viewer may see.',
                        items: timelineEntrySchema,
                      },
                      response: escalationResolutionSchema,
                      escalationId: {
                        type: 'string',
                        format: 'uuid',
                        nullable: true,
                        description:
                          'Escalation id for this flag, used by POST /assessments/escalations/{id}/resolve. Null when the flag was never escalated.',
                      },
                      expiresAt: {
                        type: 'string',
                        format: 'date-time',
                        nullable: true,
                        description:
                          'When the current escalation window closes. Null when the window never expires or the flag was never escalated.',
                      },
                      isAssignedToViewer: {
                        type: 'boolean',
                        description:
                          'True when the requesting user is the current assignee of the escalation, so they can resolve it.',
                      },
                      currentAssignee: {
                        type: 'object',
                        nullable: true,
                        description:
                          'Who holds the escalation now, the same for every viewer (not scoped like the timeline). Names are null when the level has no assignee. Stays set after the assignee accepts the flag. Null when the flag was never escalated or is closed (resolved, expired, failed or voided).',
                        properties: {
                          firstName: {type: 'string', nullable: true},
                          lastName: {type: 'string', nullable: true},
                          level: {
                            type: 'string',
                            enum: ESCALATION_LEVELS_VALUES,
                            example: 'ADMIN',
                          },
                          assignedAt: {type: 'string', format: 'date-time'},
                        },
                      },
                      type: {
                        type: 'string',
                        enum: ['AUTO', 'MANUAL'],
                        description:
                          'AUTO when an assessment raised the flag, MANUAL when a caregiver raised it.',
                      },
                      submission: {
                        type: 'object',
                        nullable: true,
                        description:
                          'The scored checklist submission behind an AUTO flag (id, submittedAt, visitNotes, template, and sections with each question merged with its answer), in the same shape as the escalation case-details endpoint. Null for MANUAL flags.',
                      },
                    },
                  },
                ],
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
          description: 'Not Found - Emergency flag not found',
        },
      },
    }),
  },

  '/api/v1/assessments/emergency-flags/{id}/void': {
    patch: createSwaggerDocs({
      tags: ['Emergency Flags'],
      summary: 'Void an emergency flag (admin only)',
      description:
        'Marks an emergency flag as voided with a required reason. The emergency flag is preserved for audit purposes but marked as invalid. This replaces the previous delete functionality to ensure data integrity. Only admins can void emergency flags.',
      parameters: [
        createIdPathParam({name: 'id', description: 'Emergency flag ID'}),
      ],
      requestBody: {
        fields: {
          voidReason: {
            type: 'string',
            description: 'Reason for voiding the emergency flag (required)',
            example: 'Reported in error - patient was not in danger',
          },
        },
        required: ['voidReason'],
      },
      responses: {
        200: {
          description: 'Emergency flag voided successfully',
          message: {
            description: 'Success message',
            example: 'Emergency flag voided successfully',
          },
          body: {
            description: 'Voided emergency flag details',
            type: 'object',
            properties: {
              emergencyFlag: emergencyFlagResponseSchema,
            },
          },
        },
        400: {
          description: 'Bad Request - Emergency flag has already been voided',
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Only admins can void emergency flags',
        },
        404: {
          description: 'Not Found - Emergency flag not found',
        },
      },
    }),
  },
};
