const {
  createSwaggerDocs,
  createIdPathParam,
} = require('../../utils/swaggerUtils');

// ==========================================
// REUSABLE SCHEMAS
// ==========================================

const questionResponseSchema = {
  type: 'object',
  description: 'Question with auto-generated id',
  properties: {
    id: {
      type: 'string',
      description: 'Auto-generated question identifier (UUID)',
      example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    },
    title: {
      type: 'string',
      description: 'Question title displayed to caregiver',
      example: "How is the member's drinking today/this week?",
    },
    type: {
      type: 'string',
      enum: [
        'textarea',
        'number',
        'boolean',
        'select',
        'multiSelect',
        'date',
        'checkbox',
      ],
      description: 'Question input type',
      example: 'select',
    },
    required: {
      type: 'boolean',
      description: 'Whether the question is required',
      example: true,
    },
    options: {
      type: 'array',
      nullable: true,
      description:
        'Answer choices. flag and points are present on PATIENT templates only; points are derived from the flag (green 0, yellow 5, red 20) and are never accepted from the client.',
      items: {
        type: 'object',
        properties: {
          title: {type: 'string', example: 'Slightly less than usual'},
          flag: {
            type: 'string',
            enum: ['green', 'yellow', 'red'],
            nullable: true,
            description: 'Null on a draft option that has no flag yet',
          },
          points: {type: 'integer', example: 5},
        },
      },
    },
    placeholder: {
      type: 'string',
      nullable: true,
      description: 'Placeholder text',
      example: 'Optional comments...',
    },
    sortOrder: {
      type: 'integer',
      description: 'Display order within section',
      example: 0,
    },
  },
};

const sectionResponseSchema = {
  type: 'object',
  description: 'Section with auto-generated id and nested questions',
  properties: {
    id: {
      type: 'string',
      description: 'Auto-generated section identifier (UUID)',
      example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    },
    title: {
      type: 'string',
      description: 'Section title',
      example: 'Hydration',
    },
    sortOrder: {
      type: 'integer',
      description: 'Display order within template',
      example: 0,
    },
    questions: {type: 'array', items: questionResponseSchema},
  },
};

const templateResponseSchema = {
  type: 'object',
  properties: {
    id: {type: 'string', description: 'Template ID'},
    organizationId: {type: 'string'},
    title: {type: 'string', example: 'Daily Health Check'},
    description: {
      type: 'string',
      nullable: true,
      example: 'Standard daily health monitoring checklist',
    },
    sections: {type: 'array', items: sectionResponseSchema},
    status: {
      type: 'string',
      enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'],
      example: 'ACTIVE',
    },
    type: {
      type: 'string',
      enum: ['PATIENT', 'FOLLOW_UP', 'SUPERVISORY_VISIT'],
      description:
        'What the template is used for. Decided at creation and never changed.',
      example: 'PATIENT',
    },
    createdAt: {type: 'string', format: 'date-time'},
    updatedAt: {type: 'string', format: 'date-time'},
  },
};

const templateUsageResponseSchema = {
  type: 'object',
  nullable: true,
  description:
    'Always present. Null unless includeUsage=true, the caller is an admin and the template is not a DRAFT. PATIENT: assignees are caregivers, total counts submitted/reviewed submissions and redFlags counts non-voided automatic red flags. FOLLOW_UP / SUPERVISORY_VISIT: assignees are case managers, total counts tasks or visits and completed counts the finished ones.',
  properties: {
    assignees: {type: 'integer', example: 268},
    patients: {type: 'integer', example: 412},
    total: {type: 'integer', example: 14208},
    completed: {
      type: 'integer',
      nullable: true,
      description: 'Null for PATIENT templates',
    },
    redFlags: {
      type: 'integer',
      nullable: true,
      description: 'Null for FOLLOW_UP and SUPERVISORY_VISIT templates',
    },
    lastActivityAt: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description:
        'Latest submission (PATIENT) or completion (other types); null when nothing has happened yet',
    },
  },
};

// Shared by create and draft edit, which both send the full section tree.
const templateSectionsRequestSchema = {
  type: 'array',
  items: {
    type: 'object',
    required: ['title'],
    properties: {
      title: {type: 'string', example: 'Hydration & output'},
      questions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['type'],
          properties: {
            title: {
              type: 'string',
              description: 'May be blank on a draft; required to publish',
            },
            type: {
              type: 'string',
              enum: [
                'textarea',
                'number',
                'boolean',
                'select',
                'multiSelect',
                'date',
                'checkbox',
              ],
            },
            required: {type: 'boolean', default: false},
            placeholder: {type: 'string', nullable: true},
            options: {
              type: 'array',
              description:
                'Answer choices. On PATIENT templates flag may be left unset while drafting but is required to publish; it is ignored on the other types, which are scored by escalation rather than by answer points.',
              items: {
                type: 'object',
                properties: {
                  title: {
                    type: 'string',
                    description: 'May be blank on a draft; required to publish',
                  },
                  flag: {
                    type: 'string',
                    enum: ['green', 'yellow', 'red'],
                    nullable: true,
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const paginationMeta = {
  type: 'object',
  properties: {
    page: {type: 'integer', example: 1},
    limit: {type: 'integer', example: 25},
    count: {type: 'integer', example: 50},
    totalPages: {type: 'integer', example: 2},
  },
};

// ==========================================
// CHECKLIST SUBMISSION REUSABLE SCHEMAS
// ==========================================

const fileObjectSchema = {
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description:
        'Presigned S3 URL of the file. Expires with the session window after the response is generated - refetch to get a new one.',
      example:
        'https://bucket.s3.region.amazonaws.com/submissions/...?X-Amz-Signature=...',
    },
    key: {
      type: 'string',
      description: 'S3 key for the file',
    },
  },
};

const answerResponseSchema = {
  type: 'object',
  properties: {
    id: {type: 'string', description: 'Answer ID'},
    questionId: {type: 'string', description: 'Template question ID'},
    value: {
      description: 'Answer value (varies by question type)',
      nullable: true,
    },
    comment: {
      type: 'string',
      nullable: true,
      description: 'Caregiver note/comment',
    },
    images: {
      type: 'array',
      nullable: true,
      description: 'Array of uploaded image files',
      items: fileObjectSchema,
    },
    createdAt: {type: 'string', format: 'date-time'},
    question: {
      type: 'object',
      description: 'The template question this answer corresponds to',
      properties: {
        id: {type: 'string'},
        title: {type: 'string'},
        type: {type: 'string'},
        required: {type: 'boolean'},
        options: {type: 'array', items: {type: 'string'}, nullable: true},
        section: {
          type: 'object',
          properties: {
            title: {type: 'string'},
          },
        },
      },
    },
  },
};

const submissionResponseSchema = {
  type: 'object',
  properties: {
    id: {type: 'string', description: 'Submission ID'},
    assignmentId: {type: 'string', description: 'Assignment ID'},
    checklistTemplateId: {type: 'string'},
    patientId: {type: 'string'},
    assigneeId: {type: 'string'},
    organizationId: {type: 'string'},
    status: {
      type: 'string',
      enum: [
        'UPCOMING',
        'PENDING',
        'LATE',
        'SUBMITTED',
        'REVIEWED',
        'MISSED',
        'SKIPPED',
        'VOIDED',
      ],
      example: 'SUBMITTED',
    },
    dueDate: {
      type: 'string',
      format: 'date',
      nullable: true,
      description: 'Due date of the submission (date-only, set by cron job)',
    },
    deadline: {
      type: 'string',
      format: 'date',
      nullable: true,
      description:
        'Deadline including grace period (date-only, set by cron job)',
    },
    visitNotes: {
      type: 'string',
      nullable: true,
      description: 'Optional visit notes from the caregiver',
      example: 'Patient was in good spirits today. No concerns.',
    },
    submittedAt: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description: 'Null until the submission is submitted',
    },
    lateDays: {
      type: 'integer',
      nullable: true,
      description:
        'Whole UTC days past the due date for LATE, SUBMITTED and REVIEWED rows (until today, or until submittedAt). Null when on time or for other statuses.',
      example: 2,
    },
    skipReason: {
      type: 'string',
      nullable: true,
      description: 'Reason given when an admin skipped the submission',
    },
    updatedAt: {type: 'string', format: 'date-time'},
    assignment: {
      type: 'object',
      properties: {
        id: {type: 'string'},
        startDate: {type: 'string', format: 'date-time'},
        endDate: {type: 'string', format: 'date-time'},
        status: {type: 'string', example: 'ACTIVE'},
        type: {type: 'string', enum: ['DAILY', 'WEEKLY', 'MONTHLY']},
        caregiverProfileId: {type: 'string'},
        assigner: {
          type: 'object',
          description: 'The user who scheduled the checklist',
          properties: {
            id: {type: 'string'},
            firstName: {type: 'string'},
            lastName: {type: 'string'},
          },
        },
      },
    },
    checklistTemplate: {
      type: 'object',
      properties: {
        title: {type: 'string', example: 'Daily Health Check'},
      },
    },
    patient: {
      type: 'object',
      properties: {
        firstName: {type: 'string', example: 'John'},
        lastName: {type: 'string', example: 'Doe'},
      },
    },
    assignee: {
      type: 'object',
      properties: {
        firstName: {type: 'string'},
        lastName: {type: 'string'},
      },
    },
    voidReason: {
      type: 'string',
      nullable: true,
      description: 'Reason for voiding the submission (set by admin)',
      example: 'Duplicate submission entered in error',
    },
    voidedAt: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description: 'Timestamp when the submission was voided',
    },
    answers: {type: 'array', items: answerResponseSchema},
  },
};

// ==========================================
// DOCS EXPORT
// ==========================================

module.exports = {
  // ==========================================
  // CHECKLIST TEMPLATE ENDPOINTS
  // ==========================================

  '/api/v1/assessments/templates': {
    get: createSwaggerDocs({
      tags: ['Checklist Templates'],
      summary: 'List checklist templates',
      description:
        'Retrieves a paginated list of checklist templates. Caregivers automatically see only PATIENT templates assigned to them. Case managers automatically see only FOLLOW_UP and SUPERVISORY_VISIT templates. Admins see all templates by default and can filter by type.',
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
          schema: {type: 'string', enum: ['title', 'status', 'createdAt']},
          description: 'Field to sort by',
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
            enum: ['DRAFT', 'ACTIVE', 'ARCHIVED', 'all'],
          },
          description:
            'Filter by status; all or omitted returns every status. DRAFT templates are only returned to admins -- other roles always get ACTIVE and ARCHIVED templates only.',
        },
        {
          in: 'query',
          name: 'type',
          schema: {
            type: 'string',
            enum: ['PATIENT', 'FOLLOW_UP', 'SUPERVISORY_VISIT'],
          },
          description:
            'Filter templates by type. Ignored for caregivers and case managers, who are auto-scoped to the types they can use. Only effective for admins.',
          example: 'PATIENT',
        },
      ],
      responses: {
        200: {
          description: 'Templates list retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Checklist templates list retrieved successfully',
          },
          body: {
            description: 'List of templates with pagination',
            type: 'object',
            properties: {
              templates: {type: 'array', items: templateResponseSchema},
              meta: paginationMeta,
            },
          },
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Insufficient permissions'},
      },
    }),

    post: createSwaggerDocs({
      tags: ['Checklist Templates'],
      summary: 'Create a checklist template',
      description:
        'Creates a checklist template as a DRAFT. Admin only. A draft may be incomplete (sections can be empty and flags unset) and cannot be used for assignments, follow-up tasks or supervisory visits until it is published via PATCH /templates/{id}/status. Once published it can no longer be edited or deleted, only archived. Option points are derived from the flag on the server (green 0, yellow 5, red 20); any points sent in the body are ignored.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['title', 'type'],
              properties: {
                title: {
                  type: 'string',
                  example: 'Post-hospital discharge check',
                },
                description: {type: 'string', nullable: true},
                type: {
                  type: 'string',
                  enum: ['PATIENT', 'FOLLOW_UP', 'SUPERVISORY_VISIT'],
                  example: 'PATIENT',
                },
                sections: templateSectionsRequestSchema,
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Template created successfully',
          message: {
            description: 'Success message',
            example: 'Checklist template created successfully',
          },
          body: {
            description: 'Created template',
            type: 'object',
            properties: {template: templateResponseSchema},
          },
        },
        400: {description: 'Bad Request - Validation failed'},
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Admin only'},
        409: {
          description:
            'Conflict - A template with this title already exists in the organization',
        },
      },
    }),
  },

  '/api/v1/assessments/templates/{id}/status': {
    patch: createSwaggerDocs({
      tags: ['Checklist Templates'],
      summary: 'Publish or archive a checklist template',
      description:
        'Moves a template one step along DRAFT -> ACTIVE -> ARCHIVED. Admin only. ACTIVE publishes a draft, after checking it is complete: at least one section, a question in every section, text on every question and option, at least one uniquely titled option on select/multiSelect questions, and a flag on every option of a PATIENT template. ARCHIVED retires an active template: it cannot be used for new assignments, follow-up tasks or supervisory visits, but every record already pointing at it keeps working. Nothing can return to DRAFT or leave ARCHIVED.',
      parameters: [
        createIdPathParam({name: 'id', description: 'Checklist Template ID'}),
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['status'],
              properties: {
                status: {
                  type: 'string',
                  enum: ['ACTIVE', 'ARCHIVED'],
                  example: 'ARCHIVED',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Template status updated successfully',
          message: {
            description: 'Success message',
            example: 'Checklist template status updated successfully',
          },
          body: {
            description: 'Updated template',
            type: 'object',
            properties: {template: templateResponseSchema},
          },
        },
        400: {
          description:
            'Bad Request - Validation failed, or the draft is not complete enough to publish (CHECKLIST_TEMPLATE_INCOMPLETE)',
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Admin only'},
        404: {description: 'Not Found - Template not found'},
        409: {
          description:
            'Conflict - The template is not in the status this change starts from (CHECKLIST_TEMPLATE_STATUS_TRANSITION_NOT_ALLOWED)',
        },
      },
    }),
  },

  '/api/v1/assessments/templates/{id}': {
    get: createSwaggerDocs({
      tags: ['Checklist Templates'],
      summary: 'Get checklist template details',
      description:
        'Retrieves a single checklist template with all sections and questions. DRAFT templates are only visible to admins; other roles get a 404 for them. Pass includeUsage=true to also get usage counts (admins only, never for drafts); leave it off when fetching a template only to copy its content.',
      parameters: [
        createIdPathParam({name: 'id', description: 'Checklist Template ID'}),
        {
          in: 'query',
          name: 'includeUsage',
          schema: {type: 'boolean', default: false},
          description:
            'Include usage counts in the response. Ignored for non-admins and for DRAFT templates, which get usage: null.',
        },
      ],
      responses: {
        200: {
          description: 'Template retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Checklist template retrieved successfully',
          },
          body: {
            description: 'Template details',
            type: 'object',
            properties: {
              template: templateResponseSchema,
              usage: templateUsageResponseSchema,
            },
          },
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Insufficient permissions'},
        404: {description: 'Not Found - Template not found'},
      },
    }),

    patch: createSwaggerDocs({
      tags: ['Checklist Templates'],
      summary: 'Edit a draft checklist template',
      description:
        'Replaces the title, description and the whole section tree of a DRAFT template. Admin only. The type is fixed at creation and cannot be changed. Published (ACTIVE or ARCHIVED) templates are never edited.',
      parameters: [
        createIdPathParam({name: 'id', description: 'Checklist Template ID'}),
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['title'],
              properties: {
                title: {
                  type: 'string',
                  example: 'Post-hospital discharge check',
                },
                description: {type: 'string', nullable: true},
                sections: templateSectionsRequestSchema,
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Template updated successfully',
          message: {
            description: 'Success message',
            example: 'Checklist template updated successfully',
          },
          body: {
            description: 'Updated template',
            type: 'object',
            properties: {template: templateResponseSchema},
          },
        },
        400: {description: 'Bad Request - Validation failed'},
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Admin only'},
        404: {description: 'Not Found - Template not found'},
        409: {
          description:
            'Conflict - The template is no longer a draft (CHECKLIST_TEMPLATE_NOT_EDITABLE), or another template already uses this title',
        },
      },
    }),

    delete: createSwaggerDocs({
      tags: ['Checklist Templates'],
      summary: 'Delete a draft checklist template',
      description:
        'Deletes a DRAFT template, freeing its title. Admin only. Published templates cannot be deleted -- archive them instead.',
      parameters: [
        createIdPathParam({name: 'id', description: 'Checklist Template ID'}),
      ],
      responses: {
        200: {
          description: 'Template deleted successfully',
          message: {
            description: 'Success message',
            example: 'Checklist template deleted successfully',
          },
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Admin only'},
        404: {description: 'Not Found - Template not found'},
        409: {
          description:
            'Conflict - The template is no longer a draft (CHECKLIST_TEMPLATE_NOT_EDITABLE)',
        },
      },
    }),
  },

  // ==========================================
  // CHECKLIST SUBMISSION ENDPOINTS
  // ==========================================

  '/api/v1/assessments/submissions': {
    get: createSwaggerDocs({
      tags: ['Checklist Submissions'],
      summary: 'List checklist submissions',
      description:
        'Retrieves a paginated list of checklist submissions. Caregivers only see their own submissions. Admin, nurses, and case managers see all submissions in the organization. Supports filtering by status (single or multiple), patient, and caregiver.',
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
          schema: {type: 'string', enum: ['submittedAt', 'status', 'dueDate']},
          description: 'Field to sort by',
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
          name: 'status',
          schema: {
            type: 'string',
            enum: [
              'UPCOMING',
              'PENDING',
              'LATE',
              'SUBMITTED',
              'REVIEWED',
              'MISSED',
              'SKIPPED',
              'VOIDED',
            ],
          },
          style: 'form',
          explode: false,
          description:
            'Filter by submission status. Provide a comma-separated list (e.g. "PENDING,LATE") to match any of the given statuses. Omit the param or pass an empty value to return all statuses.',
          example: 'PENDING,LATE',
        },
        {
          in: 'query',
          name: 'patientId',
          schema: {type: 'string'},
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
          name: 'search',
          schema: {type: 'string'},
          description:
            'Case-insensitive search across patient and caregiver (assignee) first and last names',
        },
      ],
      responses: {
        200: {
          description: 'Submissions list retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Checklist submissions list retrieved successfully',
          },
          body: {
            description: 'List of submissions with pagination',
            type: 'object',
            properties: {
              submissions: {type: 'array', items: submissionResponseSchema},
              meta: paginationMeta,
            },
          },
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Insufficient permissions'},
      },
    }),
  },

  '/api/v1/assessments/submissions/{id}': {
    get: createSwaggerDocs({
      tags: ['Checklist Submissions'],
      summary: 'Get checklist submission details',
      description:
        'Retrieves a single checklist submission with all answers (including images), template info, and full patient and caregiver details (name, email, address, phone).',
      parameters: [
        createIdPathParam({
          name: 'id',
          description: 'Checklist Submission ID',
        }),
      ],
      responses: {
        200: {
          description: 'Submission retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Checklist submission retrieved successfully',
          },
          body: {
            description: 'Submission details',
            type: 'object',
            properties: {
              submission: {
                allOf: [
                  submissionResponseSchema,
                  {
                    properties: {
                      patient: {
                        type: 'object',
                        properties: {
                          firstName: {type: 'string', example: 'John'},
                          lastName: {type: 'string', example: 'Smith'},
                          email: {
                            type: 'string',
                            nullable: true,
                            example: 'john.smith@email.com',
                          },
                          address: {
                            type: 'string',
                            nullable: true,
                            example: '123 Main St',
                          },
                          phoneNo: {
                            type: 'string',
                            nullable: true,
                            example: '+1234567890',
                          },
                        },
                      },
                      assignee: {
                        type: 'object',
                        properties: {
                          firstName: {type: 'string', example: 'Jane'},
                          lastName: {type: 'string', example: 'Doe'},
                          email: {
                            type: 'string',
                            nullable: true,
                            example: 'jane.doe@example.com',
                          },
                          address: {
                            type: 'string',
                            nullable: true,
                            example: '456 Oak Ave',
                          },
                          phoneNo: {
                            type: 'string',
                            nullable: true,
                            example: '+1987654321',
                          },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Insufficient permissions'},
        404: {description: 'Not Found - Submission not found'},
      },
    }),

    patch: createSwaggerDocs({
      tags: ['Checklist Submissions'],
      summary: 'Update/submit a checklist submission',
      description:
        'Updates an existing checklist submission via multipart/form-data. For PENDING or LATE submissions, this transitions the status to SUBMITTED and sets submittedAt. UPCOMING submissions are not yet active, and MISSED submissions cannot be updated. Send answers as a JSON string in the "answers" field. To replace images for a question, attach new files using field names "images_<questionId>". If no new files are uploaded for a question, existing images are kept.',
      parameters: [
        createIdPathParam({
          name: 'id',
          description: 'Checklist Submission ID',
        }),
      ],
      requestBody: {
        fields: {
          answers: {
            type: 'string',
            description:
              'JSON string array of answers. Each answer has questionId, value, and optional comment.',
            example:
              '[{"questionId":"fe958455-34c3-4aa4-ab9a-d5296ffb4c1d","value":"Slightly less than usual","comment":"Updated observation"}]',
          },
          visitNotes: {
            type: 'string',
            description: 'Optional updated visit notes',
            example: 'Updated notes after follow-up.',
          },
          'images_fe958455-34c3-4aa4-ab9a-d5296ffb4c1d': {
            type: 'string',
            format: 'binary',
            description:
              'New image file for a specific answer. Replace the questionId in the field name with the actual question UUID (e.g. images_<questionId>). One image per question — uploading replaces the existing image. Supported: jpeg, png, webp, heic, heif.',
          },
        },
        required: ['answers'],
        contentType: 'multipart/form-data',
      },
      responses: {
        200: {
          description: 'Checklist submission updated successfully',
          message: {
            description: 'Success message',
            example: 'Checklist submission updated successfully',
          },
          body: {
            description: 'Updated submission with answers and relations',
            type: 'object',
            properties: {
              submission: submissionResponseSchema,
            },
          },
        },
        400: {
          description:
            'Bad Request - Validation error, submission is MISSED, grace period expired, required questions unanswered, or invalid question IDs',
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Insufficient permissions'},
        404: {description: 'Not Found - Submission or template not found'},
      },
    }),
  },

  '/api/v1/assessments/submissions/{id}/void': {
    patch: createSwaggerDocs({
      tags: ['Checklist Submissions'],
      summary: 'Void a checklist submission (admin only)',
      description:
        'Marks a checklist submission as VOIDED with a required reason. Only submissions with SUBMITTED, REVIEWED, or MISSED status can be voided. Voided submissions are preserved for audit purposes but marked as invalid. This replaces the previous delete functionality to ensure data integrity.',
      parameters: [
        createIdPathParam({
          name: 'id',
          description: 'Checklist Submission ID',
        }),
      ],
      requestBody: {
        fields: {
          voidReason: {
            type: 'string',
            description: 'Reason for voiding the submission (required)',
            example: 'Duplicate submission entered in error',
          },
        },
        required: ['voidReason'],
      },
      responses: {
        200: {
          description: 'Submission voided successfully',
          message: {
            description: 'Success message',
            example: 'Checklist submission voided successfully',
          },
          body: {
            description: 'Voided submission details',
            type: 'object',
            properties: {
              submission: submissionResponseSchema,
            },
          },
        },
        400: {
          description:
            'Bad Request - Submission cannot be voided in its current status',
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Only admins can void submissions'},
        404: {description: 'Not Found - Submission not found'},
      },
    }),
  },

  '/api/v1/assessments/submissions/{id}/skip': {
    patch: createSwaggerDocs({
      tags: ['Checklist Submissions'],
      summary: 'Skip a checklist submission',
      description:
        'Marks a checklist submission as SKIPPED with a required reason. Only submissions with UPCOMING, PENDING, and LATE status can be skipped. Skipped submissions will not be recreated or have their status changed by the cron job.',
      parameters: [
        createIdPathParam({
          name: 'id',
          description: 'Checklist Submission ID',
        }),
      ],
      requestBody: {
        fields: {
          reason: {
            type: 'string',
            description: 'Reason for skipping the submission (required)',
            example: 'Patient was unavailable for assessment',
          },
        },
      },
      responses: {
        200: {
          description: 'Submission skipped successfully',
          message: {
            description: 'Success message',
            example: 'Checklist submission skipped successfully',
          },
          body: {
            description: 'Skipped submission details',
            type: 'object',
            properties: {
              submission: {
                type: 'object',
                properties: {
                  id: {type: 'string'},
                  status: {type: 'string', example: 'SKIPPED'},
                  skipReason: {
                    type: 'string',
                    example: 'Patient was unavailable for assessment',
                  },
                  assignmentId: {type: 'string'},
                  checklistTemplateId: {type: 'string'},
                  patientId: {type: 'string'},
                  assigneeId: {type: 'string'},
                  dueDate: {type: 'string', format: 'date-time'},
                  deadline: {type: 'string', format: 'date-time'},
                },
              },
            },
          },
        },
        400: {
          description:
            'Bad Request - Only submissions with UPCOMING, PENDING, and LATE status can be skipped',
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Insufficient permissions'},
        404: {description: 'Not Found - Submission not found'},
      },
    }),
  },

  '/api/v1/assessments/escalations/{escalationId}/resolve': {
    post: createSwaggerDocs({
      tags: ['Checklist Submissions'],
      summary: 'Resolve a raised flag (escalation)',
      description:
        'Records the current assignee\'s resolution for one escalation via multipart/form-data, flips the flag + escalation to RESOLVED, and optionally schedules a follow-up task and/or supervisory visit for the patient\'s case manager. Self-scoped: only the user currently assigned to the escalation may resolve it. Up to 5 supporting files (images, PDF, or Word .doc/.docx) may be attached under the "files" field. Non-file fields are sent as form fields — send "actions" as a JSON array string, and booleans/dates as their string values.',
      parameters: [
        createIdPathParam({
          name: 'escalationId',
          description: 'Escalation ID',
        }),
      ],
      requestBody: {
        fields: {
          actions: {
            type: 'string',
            description:
              'JSON string array of response action codes (ESCALATION_RESPONSE_ACTIONS). At least one, no duplicates.',
            example: '[0, 2]',
          },
          notes: {
            type: 'string',
            description: 'Resolution notes (required, max 5000 chars)',
            example:
              'Contacted patient, vitals stable, no further action needed.',
          },
          hasFollowUp: {
            type: 'string',
            description:
              'Whether to schedule a follow-up task for the case manager ("true"/"false")',
            example: 'false',
          },
          followUpDate: {
            type: 'string',
            format: 'date-time',
            description:
              'Follow-up due date (required when hasFollowUp is true)',
            example: '2026-07-01T10:00:00.000Z',
          },
          followUpDescription: {
            type: 'string',
            description:
              'Follow-up instructions (required when hasFollowUp is true, max 2000 chars)',
            example: 'Re-check blood pressure and medication adherence.',
          },
          followUpChecklistTemplateId: {
            type: 'string',
            format: 'uuid',
            description:
              'Optional ACTIVE follow-up checklist template of this organization',
          },
          followUpAssigneeUserOrganizationId: {
            type: 'string',
            format: 'uuid',
            description:
              'Care-team member to own the follow-up task; defaults to the patient’s case manager',
          },
          hasSupervisoryVisit: {
            type: 'string',
            description:
              'Whether to schedule a supervisory visit triggered by this alert ("true"/"false")',
            example: 'false',
          },
          supervisoryVisitStartAt: {
            type: 'string',
            format: 'date-time',
            description:
              'Supervisory visit start (required when hasSupervisoryVisit is true, must be in the future)',
            example: '2026-07-03T13:00:00.000Z',
          },
          supervisoryVisitEndAt: {
            type: 'string',
            format: 'date-time',
            description:
              'Supervisory visit end (required when hasSupervisoryVisit is true, after the start)',
            example: '2026-07-03T14:00:00.000Z',
          },
          supervisoryVisitAssigneeUserOrganizationId: {
            type: 'string',
            format: 'uuid',
            description:
              'Nurse / admin / case manager on the care team to perform the visit; defaults to the patient’s case manager',
          },
          supervisoryVisitCaregiverUserOrganizationIds: {
            type: 'string',
            description:
              'JSON-encoded array of caregiver userOrgIds present at the visit',
          },
          supervisoryVisitChecklistTemplateId: {
            type: 'string',
            format: 'uuid',
            description:
              'ACTIVE supervisory visit checklist template of this organization (required when hasSupervisoryVisit is true)',
          },
          supervisoryInstructions: {
            type: 'string',
            description:
              'Supervisory visit instructions (required when hasSupervisoryVisit is true, max 2000 chars)',
            example: 'Review care plan with the assigned caregiver on-site.',
          },
          files: {
            type: 'array',
            items: {type: 'string', format: 'binary'},
            description:
              'Optional supporting files (up to 5). Supported: images (jpeg, png, webp, heic, heif), PDF, and Word (.doc, .docx). Max 5 MB each.',
          },
        },
        required: ['actions', 'notes'],
        contentType: 'multipart/form-data',
      },
      responses: {
        201: {
          description: 'Flag resolved successfully',
          message: {
            description: 'Success message',
            example: 'Flag resolved successfully',
          },
          body: {
            description: 'The created escalation resolution',
            type: 'object',
            properties: {
              response: {
                type: 'object',
                properties: {
                  id: {type: 'string'},
                  escalationId: {type: 'string'},
                  submissionFlagId: {type: 'string'},
                  actions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        value: {type: 'integer', example: 0},
                        label: {type: 'string', example: 'Contacted patient'},
                      },
                    },
                  },
                  notes: {type: 'string', nullable: true},
                  attachments: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        url: {type: 'string'},
                        key: {type: 'string'},
                      },
                    },
                  },
                  hasFollowUp: {type: 'boolean'},
                  followUpDate: {
                    type: 'string',
                    format: 'date-time',
                    nullable: true,
                  },
                  followUpDescription: {type: 'string', nullable: true},
                  hasSupervisoryVisit: {type: 'boolean'},
                  supervisoryVisitDate: {
                    type: 'string',
                    format: 'date-time',
                    nullable: true,
                  },
                  supervisoryInstructions: {type: 'string', nullable: true},
                  submittedBy: {type: 'string'},
                  createdAt: {type: 'string', format: 'date-time'},
                },
              },
            },
          },
        },
        400: {
          description:
            'Bad Request - Validation error, too many attachments, escalation already resolved or expired, caller is not the assignee, patient has no case manager, or no supervisory template available',
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        404: {description: 'Not Found - Escalation not found'},
      },
    }),
  },

  '/api/v1/assessments/escalations/{escalationId}/accept': {
    patch: createSwaggerDocs({
      tags: ['Checklist Submissions'],
      summary: 'Accept a raised flag (escalation)',
      description:
        'The current assignee accepts the flag. The escalation becomes ACKNOWLEDGED (shown as Accepted) and the flag ACCEPTED; its deadline is cleared, so it never escalates to the next level and stays with the caller until they resolve it. Not available at the ADMIN step, which never escalates. No notifications are sent.',
      parameters: [
        createIdPathParam({
          name: 'escalationId',
          description: 'Escalation ID',
        }),
      ],
      responses: {
        200: {
          description: 'Flag accepted successfully',
          message: {
            description: 'Success message',
            example: 'Flag accepted successfully',
          },
          body: {
            description: 'The accepted escalation',
            type: 'object',
            properties: {
              escalation: {
                type: 'object',
                properties: {
                  id: {type: 'string'},
                  submissionFlagId: {type: 'string'},
                  status: {type: 'string', example: 'ACKNOWLEDGED'},
                  acknowledgedAt: {type: 'string', format: 'date-time'},
                },
              },
            },
          },
        },
        400: {
          description:
            'Bad Request - Validation error, or caller is not the assignee',
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        404: {description: 'Not Found - Escalation not found'},
        409: {
          description:
            'Conflict - Escalation already accepted, resolved or voided, at the ADMIN step, or its deadline has passed',
        },
      },
    }),
  },
};
