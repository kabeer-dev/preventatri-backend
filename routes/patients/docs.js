const {
  PATIENTS_LIST_API_FIELDS_OPTIONS,
  PATIENTS_LIST_API_VIEWS_VALUES,
} = require('../../constants/patientsConstants');

const {
  createSwaggerDocs,
  createIdPathParam,
} = require('../../utils/swaggerUtils');

// Caregiver assignment sub-schema
const caregiverAssignmentSchema = {
  type: 'object',
  properties: {
    profileId: {type: 'string', description: 'Caregiver profile ID'},
    role: {
      type: 'string',
    },
    status: {type: 'string', enum: ['ACTIVE', 'INACTIVE']},
    assignedAt: {type: 'string', format: 'date-time'},
    user: {
      type: 'object',
      properties: {
        id: {type: 'string'},
        firstName: {type: 'string', example: 'Jane'},
        lastName: {type: 'string', example: 'Doe'},
        email: {type: 'string', example: 'jane.doe@example.com'},
        phoneNo: {type: 'string', example: '+1234567890'},
      },
    },
  },
};

// Checklist assignment sub-schema
const checklistAssignmentSchema = {
  type: 'object',
  properties: {
    id: {type: 'string', description: 'Assignment ID'},
    checklistTemplateId: {type: 'string'},
    patientId: {type: 'string'},
    caregiverProfileId: {type: 'string'},
    organizationId: {type: 'string'},
    assignedBy: {type: 'string'},
    startDate: {type: 'string', format: 'date-time'},
    endDate: {type: 'string', format: 'date-time'},
    notes: {type: 'string', nullable: true},
    status: {type: 'string', enum: ['ACTIVE', 'INACTIVE']},
    type: {type: 'string', enum: ['DAILY', 'WEEKLY', 'MONTHLY']},
    createdAt: {type: 'string', format: 'date-time'},
    checklistTemplate: {
      type: 'object',
      properties: {
        id: {type: 'string'},
        title: {type: 'string', example: 'Daily Health Check'},
      },
    },
    caregiverProfile: {
      type: 'object',
      properties: {
        id: {type: 'string'},
        role: {type: 'string'},
        user: {
          type: 'object',
          properties: {
            id: {type: 'string'},
            firstName: {type: 'string', example: 'Jane'},
            lastName: {type: 'string', example: 'Doe'},
            email: {type: 'string', example: 'jane.doe@example.com'},
          },
        },
      },
    },
    assigner: {
      type: 'object',
      properties: {
        id: {type: 'string'},
        firstName: {type: 'string'},
        lastName: {type: 'string'},
      },
    },
  },
};

// Compact nurse reference embedded on a patient (primary/secondary).
const patientNurseRefSchema = {
  type: 'object',
  nullable: true,
  properties: {
    id: {type: 'string', description: 'NurseProfile ID'},
    user: {
      type: 'object',
      nullable: true,
      properties: {
        id: {type: 'string'},
        firstName: {type: 'string', example: 'Jane'},
        lastName: {type: 'string', example: 'Doe'},
      },
    },
  },
};

// Patient response schema
// Minimal patient shape returned by create/update
const patientMinimalResponseSchema = {
  type: 'object',
  properties: {
    id: {type: 'string', format: 'uuid'},
    firstName: {type: 'string', example: 'John'},
    lastName: {type: 'string', example: 'Doe'},
  },
};

const patientResponseSchema = {
  type: 'object',
  properties: {
    id: {type: 'string', description: 'Patient ID'},
    organizationId: {type: 'string'},
    firstName: {type: 'string', example: 'John'},
    lastName: {type: 'string', example: 'Smith'},
    dateOfBirth: {type: 'string', format: 'date', example: '1960-05-15'},
    gender: {type: 'string', enum: ['M', 'F', 'OTHER'], example: 'M'},
    county: {
      type: 'object',
      nullable: true,
      properties: {
        id: {type: 'string'},
        name: {type: 'string', example: 'Adams'},
      },
    },
    region: {
      type: 'object',
      nullable: true,
      properties: {
        id: {type: 'string'},
        name: {type: 'string', example: 'Southeast Pennsylvania'},
        code: {type: 'string', example: 'SOUTHEAST_PENNSYLVANIA'},
      },
    },
    address: {type: 'string', nullable: true, example: '123 Main St'},
    city: {type: 'string', nullable: true, example: 'Philadelphia'},
    state: {type: 'string', nullable: true, example: 'PA'},
    zipCode: {type: 'string', nullable: true, example: '19103'},
    email: {type: 'string', nullable: true, example: 'john.smith@email.com'},
    phoneNo: {type: 'string', nullable: true, example: '+1234567890'},
    emergencyContact: {type: 'string', nullable: true},
    medicaidId: {type: 'string', nullable: true},
    diagnoses: {type: 'string', nullable: true},
    riskLevel: {
      type: 'string',
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      nullable: true,
    },
    notes: {type: 'string', nullable: true},
    status: {
      type: 'string',
      enum: [
        'ACTIVE',
        'WAITING',
        'HOSPITALIZED',
        'HOLD',
        'DISCHARGED',
        'ARCHIVED',
      ],
      example: 'ACTIVE',
    },
    deletedAt: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description:
        'Soft-delete timestamp. Null when the patient is active; set to the deletion time when archived.',
    },
    archived: {
      type: 'boolean',
      description: 'True when the patient has been soft-deleted (archived).',
      example: false,
    },
    primaryNurseProfileId: {
      type: 'string',
      nullable: true,
      description:
        "NurseProfile ID assigned as the patient primary nurse. On a MANUAL patient it must be a PRIMARY nurse for the patient region; on an HHA_EXCHANGE patient it is HHAeXchange's NurseID, set by the sync regardless of region, or an admin's pick while isPrimaryNurseHhaManaged is false.",
    },
    isPrimaryNurseHhaManaged: {
      type: 'boolean',
      example: false,
      description:
        'True while the primary nurse is the one HHAeXchange names; primaryNurseProfileId is then read-only unless hhaPendingNurse is set. False when HHAeXchange names no nurse (or one not imported here), and an admin picks the primary nurse.',
    },
    hhaPendingNurse: {
      type: 'object',
      nullable: true,
      description:
        'The nurse HHAeXchange names who is not linked yet because they have not accepted an invitation or are not active. While set, an admin may pick another primary nurse. Detail view only.',
    },
    hhaPendingCaseManager: {
      type: 'object',
      nullable: true,
      description:
        'The case manager HHAeXchange names who is not linked yet, for the same reason. While set, caseManagerProfileId is editable. Detail view only.',
    },
    isCaseManagerHhaManaged: {
      type: 'boolean',
      example: false,
      description:
        'True while the sync set the case manager of an HHA_EXCHANGE patient; false once an admin picked one.',
    },
    isCountyHhaManaged: {
      type: 'boolean',
      example: false,
      description:
        'True while the HHAeXchange ZIP resolves to a county; the sync then owns countyId and it is read-only. False when it cannot resolve, and an admin sets the county.',
    },
    secondaryNurseProfileId: {
      type: 'string',
      nullable: true,
      description:
        'NurseProfile ID assigned as the patient secondary nurse (must be a SECONDARY nurse for the patient region, and must differ from the primary).',
    },
    primaryNurse: patientNurseRefSchema,
    secondaryNurse: patientNurseRefSchema,
    caseManager: {
      type: 'object',
      nullable: true,
      description:
        "The patient's case manager ({id: CaseManagerProfile id, user}). Returned by the detail endpoint and the table list view.",
      properties: patientNurseRefSchema.properties,
    },
    assignedCaregivers: {
      type: 'array',
      description:
        'Every caregiver assigned to the patient, once each: linked directly or through a non-deleted assessment ({id: CaregiverProfile id, user}). Returned by the detail endpoint and the table list view.',
      items: {type: 'object', properties: patientNurseRefSchema.properties},
    },
    caregivers: {type: 'array', items: caregiverAssignmentSchema},
    caregiverCount: {type: 'integer', example: 1},
    redFlagCount: {
      type: 'integer',
      description:
        'Number of red flags for this patient. When `caregiverId` is provided in the request, this count includes only red flags submitted by that caregiver; otherwise, it reflects the total number of red flags submitted against the patient.',
      example: 3,
    },
    lastFlag: {
      type: 'string',
      enum: ['RED', 'YELLOW'],
      nullable: true,
      description:
        'Severity of the newest non-voided RED or YELLOW flag; null when there is none. Scoped to the caller like redFlagCount. Returned only by the table list view.',
    },
    checklistAssignments: {
      type: 'array',
      items: checklistAssignmentSchema,
      description: 'Checklist assignments for this patient',
    },
    createdAt: {type: 'string', format: 'date-time'},
    updatedAt: {type: 'string', format: 'date-time'},
  },
};

module.exports = {
  '/api/v1/patients': {
    post: createSwaggerDocs({
      tags: ['Patients'],
      summary: 'Create a patient',
      description:
        'Creates a new patient record. County ID is required and the region is auto-derived from the county. Optionally assigns caregivers.',
      requestBody: {
        fields: {
          firstName: {
            type: 'string',
            description: 'First name',
            example: 'John',
          },
          lastName: {
            type: 'string',
            description: 'Last name',
            example: 'Smith',
          },
          dateOfBirth: {
            type: 'string',
            format: 'date',
            description: 'Date of birth',
            example: '1960-05-15',
          },
          gender: {
            type: 'string',
            enum: ['M', 'F', 'OTHER'],
            description: 'Gender',
            example: 'M',
          },
          countyId: {
            type: 'string',
            description: 'County ID (required, region auto-derived)',
          },
          status: {
            type: 'string',
            enum: [
              'ACTIVE',
              'WAITING',
              'HOSPITALIZED',
              'HOLD',
              'DISCHARGED',
              'ARCHIVED',
            ],
            description: 'Patient status (default: ACTIVE)',
          },
          address: {type: 'string', description: 'Street address'},
          city: {type: 'string', description: 'City'},
          state: {type: 'string', description: 'State code (2 chars)'},
          zipCode: {type: 'string', description: 'ZIP code'},
          email: {type: 'string', description: 'Email address'},
          phoneNo: {type: 'string', description: 'Phone number'},
          emergencyContact: {
            type: 'string',
            description: 'Emergency contact info',
          },
          medicaidId: {type: 'string', description: 'Medicaid ID'},
          diagnoses: {type: 'string', description: 'Diagnoses'},
          notes: {type: 'string', description: 'Additional notes'},
          riskLevel: {
            type: 'string',
            enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
            description: 'Risk level',
          },
          caregiverProfileIds: {
            type: 'array',
            description: 'Caregiver profile IDs to assign (optional)',
            items: {type: 'string'},
          },
          primaryNurseProfileId: {
            type: 'string',
            nullable: true,
            description:
              'Optional NurseProfile ID for the patient primary nurse. Must be ACTIVE + verified and have role PRIMARY for the patient region.',
          },
          secondaryNurseProfileId: {
            type: 'string',
            nullable: true,
            description:
              'Optional NurseProfile ID for the patient secondary nurse. Must be ACTIVE + verified and have role SECONDARY for the patient region. Must differ from primaryNurseProfileId when both are set.',
          },
        },
        required: [
          'firstName',
          'lastName',
          'dateOfBirth',
          'gender',
          'countyId',
        ],
      },
      responses: {
        201: {
          description: 'Patient created successfully',
          message: {
            description: 'Success message',
            example: 'Patient created successfully',
          },
          body: {
            description: 'Created patient',
            type: 'object',
            properties: {
              patient: patientMinimalResponseSchema,
            },
          },
        },
        400: {
          description:
            'Bad Request - Validation error or invalid county/caregiver IDs',
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Insufficient permissions',
        },
      },
    }),

    get: createSwaggerDocs({
      tags: ['Patients'],
      summary: 'List patients in organization',
      description:
        'Retrieves a paginated list of patients with caregiver assignments, county, and region info. Supports filtering by status, region, and county.',
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
            enum: [
              'firstName',
              'lastName',
              'status',
              'createdAt',
              'dateOfBirth',
            ],
          },
          description: 'Field to sort by',
          example: 'lastName',
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
          schema: {
            type: 'string',
            enum: [
              'ACTIVE',
              'WAITING',
              'HOSPITALIZED',
              'HOLD',
              'DISCHARGED',
              'ARCHIVED',
              'all',
            ],
          },
          description: 'Filter by status',
        },
        {
          in: 'query',
          name: 'source',
          schema: {type: 'string'},
          description:
            'Filter by record source. Comma-separated list of MANUAL, HHA_EXCHANGE, e.g. "MANUAL,HHA_EXCHANGE". Omit to return every source.',
          example: 'HHA_EXCHANGE',
        },
        {
          in: 'query',
          name: 'countyId',
          schema: {type: 'string', format: 'uuid'},
          description: 'Filter by county ID',
        },
        {
          in: 'query',
          name: 'regionId',
          schema: {type: 'string'},
          description:
            "Filter by the county's region. Comma-separated region IDs; matches any.",
        },
        {
          in: 'query',
          name: 'nurseProfileId',
          schema: {type: 'string'},
          description:
            'Filter by care team. Comma-separated nurse profile IDs; matches patients where any of them is the primary or secondary nurse.',
        },
        {
          in: 'query',
          name: 'lastFlag',
          schema: {type: 'string'},
          description:
            "Filter by risk tier: the severity of the patient's newest non-voided flag. Comma-separated list of RED, YELLOW.",
          example: 'RED',
        },
        {
          in: 'query',
          name: 'caregiverId',
          schema: {type: 'string', format: 'uuid'},
          description:
            'Filter by caregiver profile ID to get assigned patients',
        },
        {
          in: 'query',
          name: 'search',
          schema: {type: 'string', maxLength: 200},
          description:
            'Filter by patient name (case-insensitive). Each whitespace-separated token must match firstName or lastName, e.g. "john sm" matches "John Smith".',
          example: 'John',
        },
        {
          in: 'query',
          name: 'archiveFilter',
          schema: {
            type: 'string',
            enum: ['active', 'all', 'archived'],
            default: 'active',
          },
          description:
            'Archive view filter. "active" (default) returns only non-deleted patients, "all" returns active + soft-deleted patients, "archived" returns only soft-deleted patients.',
          example: 'active',
        },
        {
          in: 'query',
          name: 'view',
          schema: {
            type: 'string',
            enum: PATIENTS_LIST_API_VIEWS_VALUES,
          },
          description: `Optional response view. When set, each patient in the list contains only that view's fields instead of the full patient object. Omit to return the full patient object. ${Object.values(
            PATIENTS_LIST_API_FIELDS_OPTIONS
          )
            .map((option) => `"${option.value}": ${option.fields.join(', ')}.`)
            .join(' ')}`,
          example: 'minimal',
        },
      ],
      responses: {
        200: {
          description: 'Patients list retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Patients list retrieved successfully',
          },
          body: {
            description: 'List of patients with pagination',
            type: 'object',
            properties: {
              patients: {
                type: 'array',
                description:
                  'Full patient objects, or only the selected view\'s fields when the "view" query param is set.',
                items: patientResponseSchema,
              },
              meta: {
                type: 'object',
                properties: {
                  page: {type: 'integer', example: 1},
                  limit: {type: 'integer', example: 25},
                  count: {type: 'integer', example: 50},
                  totalPages: {type: 'integer', example: 2},
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

  '/api/v1/patients/stats': {
    get: createSwaggerDocs({
      tags: ['Patients'],
      summary: 'Get patient dashboard stats',
      description:
        'Returns organization-scoped patient metrics: total patients, active ' +
        'red and yellow flag counts (flags whose escalation is still ACTIVE — ' +
        'neither resolved nor failed), and total green flags. Requires VIEW ' +
        'permission on the patient entity.',
      responses: {
        200: {
          description: 'Patient stats retrieved successfully',
          message: {
            description: 'A message describing the result of the operation',
            example: 'Patient stats retrieved successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              stats: {
                type: 'object',
                description: 'Aggregated organization-level patient metrics',
                properties: {
                  patients: {
                    type: 'integer',
                    description: 'Total number of patients in the organization',
                    example: 128,
                  },
                  activeRedFlags: {
                    type: 'integer',
                    description:
                      'Red flags with an active (unresolved, unfailed) ' +
                      'escalation',
                    example: 4,
                  },
                  activeYellowFlags: {
                    type: 'integer',
                    description:
                      'Yellow flags with an active (unresolved, unfailed) ' +
                      'escalation',
                    example: 7,
                  },
                  greenFlags: {
                    type: 'integer',
                    description: 'Total green flags in the organization',
                    example: 240,
                  },
                  slaBreaches: {
                    type: 'integer',
                    description:
                      'Escalation step deadlines missed in the last 30 days; ' +
                      'a flag that escalated three times counts three',
                    example: 2,
                  },
                  averageResolutionMinutes: {
                    type: 'number',
                    nullable: true,
                    description:
                      'Average minutes from raised to resolved, over flags ' +
                      'resolved in the last 30 days; null when none were',
                    example: 42.5,
                  },
                },
              },
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'PATIENT_STATS_RETRIEVED',
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

  '/api/v1/patients/{id}/timeline': {
    get: createSwaggerDocs({
      tags: ['Patients'],
      summary: 'Get patient timeline',
      description:
        'Returns the patient activity feed, newest first, one page at a time: patient added/updated, flags raised/resolved/voided (any colour), checklist assignments created/updated/removed, follow-up tasks created/completed/cancelled, supervisory visits scheduled/completed/reviewed/cancelled, and submitted assessments. Request page=1 first, then page=2, 3... while page < meta.totalPages. Built from existing records only (no separate history table), so "updated" entries come from the last-updated time and carry no user. Access: Admins, Case Managers and Nurses within their patient scope — caregivers are not permitted.',
      parameters: [
        createIdPathParam({name: 'id', description: 'Patient ID'}),
        {
          in: 'query',
          name: 'page',
          schema: {type: 'integer', minimum: 1, default: 1},
          description: 'Page number',
          example: 1,
        },
        {
          in: 'query',
          name: 'limit',
          schema: {type: 'integer', minimum: 1, maximum: 100, default: 25},
          description: 'Entries per page',
          example: 25,
        },
      ],
      responses: {
        200: {
          description: 'Patient timeline retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Patient timeline retrieved successfully',
          },
          body: {
            description: 'One page of timeline entries',
            type: 'object',
            properties: {
              timeline: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      enum: [
                        'PATIENT_ADDED',
                        'PATIENT_UPDATED',
                        'FLAG_RAISED',
                        'FLAG_RESOLVED',
                        'FLAG_VOIDED',
                        'ASSIGNMENT_CREATED',
                        'ASSIGNMENT_UPDATED',
                        'ASSIGNMENT_REMOVED',
                        'FOLLOW_UP_TASK_CREATED',
                        'FOLLOW_UP_TASK_COMPLETED',
                        'FOLLOW_UP_TASK_CANCELLED',
                        'SUPERVISORY_VISIT_SCHEDULED',
                        'SUPERVISORY_VISIT_COMPLETED',
                        'SUPERVISORY_VISIT_REVIEWED',
                        'SUPERVISORY_VISIT_CANCELLED',
                        'ASSESSMENT_SUBMITTED',
                      ],
                    },
                    at: {type: 'string', format: 'date-time'},
                    user: {
                      type: 'object',
                      nullable: true,
                      description:
                        'Who performed the step; null when not recorded (patient added/updated, assignment updated/removed)',
                      properties: {
                        firstName: {type: 'string', nullable: true},
                        lastName: {type: 'string', nullable: true},
                      },
                    },
                    notes: {
                      type: 'string',
                      nullable: true,
                      description:
                        'Context: resolution notes, void/cancel reason, review note, task title or checklist template title',
                    },
                    refId: {
                      type: 'string',
                      description:
                        'ID of the related record (flag, assignment, task, visit, submission or patient)',
                    },
                    flag: {
                      type: 'string',
                      description:
                        'Flag colour; present only on FLAG_* entries',
                      example: 'RED',
                    },
                  },
                },
              },
              meta: {
                type: 'object',
                properties: {
                  page: {type: 'integer', example: 1},
                  limit: {type: 'integer', example: 25},
                  count: {type: 'integer', example: 125},
                  totalPages: {type: 'integer', example: 5},
                },
              },
            },
          },
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description:
            'Forbidden - Insufficient permissions (caregivers are not permitted)',
        },
        404: {
          description:
            'Not Found - Patient not found or outside the viewer scope',
        },
      },
    }),
  },

  '/api/v1/patients/{id}/assessments': {
    get: createSwaggerDocs({
      tags: ['Patients'],
      summary: 'Get patient upcoming assessments',
      description:
        'Returns PENDING and LATE checklist submissions for a patient due within the next 7 days, sorted by deadline ascending. Access: Admins and Caregivers only — nurses are not permitted.',
      parameters: [createIdPathParam({name: 'id', description: 'Patient ID'})],
      responses: {
        200: {
          description: 'Patient upcoming assessments retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Patient upcoming assessments retrieved successfully',
          },
          body: {
            description: 'Upcoming assessments list',
            type: 'object',
            properties: {
              submissions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: {type: 'string'},
                    patientId: {type: 'string'},
                    checklistTemplateId: {type: 'string'},
                    status: {type: 'string', enum: ['PENDING', 'LATE']},
                    deadline: {type: 'string', format: 'date-time'},
                    createdAt: {type: 'string', format: 'date-time'},
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
          description: 'Not Found - Patient not found',
        },
      },
    }),
  },

  '/api/v1/patients/{id}': {
    get: createSwaggerDocs({
      tags: ['Patients'],
      summary: 'Get patient details',
      description:
        'Retrieves detailed information about a specific patient including caregivers, county, region, and checklist assignments.',
      parameters: [createIdPathParam({name: 'id', description: 'Patient ID'})],
      responses: {
        200: {
          description: 'Patient retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Patient retrieved successfully',
          },
          body: {
            description: 'Patient details',
            type: 'object',
            properties: {
              patient: patientResponseSchema,
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
          description: 'Not Found - Patient not found',
        },
      },
    }),

    patch: createSwaggerDocs({
      tags: ['Patients'],
      summary: 'Update patient',
      description:
        'Updates patient information. At least one field must be provided. ' +
        'On an HHA_EXCHANGE patient the HHAeXchange-owned fields (demographics, address, phone, emergency contact, medicaidId), primaryNurseProfileId while isPrimaryNurseHhaManaged is true and hhaPendingNurse is null, and countyId while isCountyHhaManaged is true are read-only; sending one answers 400 HHA_MANAGED_FIELD_READ_ONLY. The secondary nurse stays editable and is validated against the patient region. ' +
        'caseManagerProfileId (HHA_EXCHANGE patients only; null clears it) is accepted while hhaPendingCaseManager is set or the current case manager is an admin pick, and must be an active case manager who accepted an invitation (400 INVALID_CASE_MANAGER_ASSIGNMENT otherwise).',
      parameters: [createIdPathParam({name: 'id', description: 'Patient ID'})],
      requestBody: {
        fields: {
          firstName: {type: 'string', description: 'First name'},
          lastName: {type: 'string', description: 'Last name'},
          dateOfBirth: {
            type: 'string',
            format: 'date',
            description: 'Date of birth',
          },
          gender: {
            type: 'string',
            enum: ['M', 'F', 'OTHER'],
            description: 'Gender',
          },
          countyId: {
            type: 'string',
            description: 'County ID (region auto-derived)',
          },
          status: {
            type: 'string',
            enum: [
              'ACTIVE',
              'WAITING',
              'HOSPITALIZED',
              'HOLD',
              'DISCHARGED',
              'ARCHIVED',
            ],
          },
          address: {type: 'string'},
          city: {type: 'string'},
          state: {type: 'string'},
          zipCode: {type: 'string'},
          email: {type: 'string'},
          phoneNo: {type: 'string'},
          emergencyContact: {type: 'string'},
          medicaidId: {type: 'string'},
          diagnoses: {type: 'string'},
          notes: {type: 'string'},
          riskLevel: {
            type: 'string',
            enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
          },
          primaryNurseProfileId: {
            type: 'string',
            nullable: true,
            description:
              'Optional NurseProfile ID for the patient primary nurse. Send null to clear. Must be ACTIVE + verified and have role PRIMARY for the patient region. Must differ from secondaryNurseProfileId when both are set.',
          },
          secondaryNurseProfileId: {
            type: 'string',
            nullable: true,
            description:
              'Optional NurseProfile ID for the patient secondary nurse. Send null to clear. Must be ACTIVE + verified and have role SECONDARY for the patient region.',
          },
        },
        required: [],
      },
      responses: {
        200: {
          description: 'Patient updated successfully',
          message: {
            description: 'Success message',
            example: 'Patient updated successfully',
          },
          body: {
            description: 'Updated patient',
            type: 'object',
            properties: {
              patient: patientMinimalResponseSchema,
            },
          },
        },
        400: {
          description: 'Bad Request - Validation error or invalid county ID',
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Insufficient permissions',
        },
        404: {
          description: 'Not Found - Patient not found',
        },
      },
    }),

    delete: createSwaggerDocs({
      tags: ['Patients'],
      summary: 'Delete patient (soft delete)',
      description: 'Soft deletes a patient record.',
      parameters: [createIdPathParam({name: 'id', description: 'Patient ID'})],
      responses: {
        200: {
          description: 'Patient deleted successfully',
          message: {
            description: 'Success message',
            example: 'Patient deleted successfully',
          },
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Insufficient permissions',
        },
        404: {
          description: 'Not Found - Patient not found',
        },
      },
    }),
  },
};
