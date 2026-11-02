const {
  CHECKLIST_ASSIGNMENT_TYPES_VALUES,
} = require('../../constants/checklistAssignmentConstants');

const {
  createSwaggerDocs,
  createIdPathParam,
} = require('../../utils/swaggerUtils');

// Reusable sub-schemas
const userRefSchema = {
  type: 'object',
  properties: {
    id: {type: 'string'},
    firstName: {type: 'string', example: 'Jane'},
    lastName: {type: 'string', example: 'Doe'},
  },
};

const patientRefSchema = {
  type: 'object',
  properties: {
    id: {type: 'string'},
    firstName: {type: 'string', example: 'John'},
    lastName: {type: 'string', example: 'Smith'},
  },
};

const templateRefSchema = {
  type: 'object',
  properties: {
    id: {type: 'string'},
    title: {type: 'string', example: 'Daily Health Check'},
  },
};

const assignmentResponseSchema = {
  type: 'object',
  properties: {
    id: {type: 'string', description: 'Assignment ID'},
    checklistTemplateId: {type: 'string'},
    patientId: {type: 'string'},
    caregiverProfileId: {type: 'string'},
    organizationId: {type: 'string'},
    assignedBy: {type: 'string', description: 'User ID of the assigner'},
    startDate: {
      type: 'string',
      format: 'date',
      description: 'Assignment start date (date-only)',
      example: '2026-03-20',
    },
    endDate: {
      type: 'string',
      format: 'date',
      description: 'Assignment end date (date-only)',
      example: '2026-04-20',
    },
    type: {
      type: 'string',
      enum: CHECKLIST_ASSIGNMENT_TYPES_VALUES,
      description: 'Assignment frequency type',
      example: 'DAILY',
    },
    notes: {
      type: 'string',
      nullable: true,
      description: 'Optional assignment notes or instructions',
      example: 'Please complete this checklist every morning before 10 AM.',
    },
    createdAt: {type: 'string', format: 'date-time'},
    updatedAt: {type: 'string', format: 'date-time'},
    checklistTemplate: templateRefSchema,
    patient: patientRefSchema,
    caregiverProfile: {
      type: 'object',
      properties: {
        id: {type: 'string'},
        role: {type: 'string', example: 'Primary Caregiver'},
        user: userRefSchema,
      },
    },
    assigner: userRefSchema,
  },
};

const paginationMeta = {
  type: 'object',
  properties: {
    page: {type: 'integer', example: 1},
    limit: {type: 'integer', example: 25},
    count: {type: 'integer', example: 10},
    totalPages: {type: 'integer', example: 1},
  },
};

module.exports = {
  '/api/v1/assessments/assignments': {
    post: createSwaggerDocs({
      tags: ['Checklist Assignments'],
      summary: 'Create checklist assignments',
      description:
        'Assigns checklist templates to caregivers for patients in bulk. Accepts an array of assignments. Only admins and case managers can create assignments. Each checklist template must be ACTIVE, and no duplicate active assignment can exist for the same caregiver+patient+template combination.',
      requestBody: {
        fields: {
          assignments: {
            type: 'array',
            description: 'Array of assignments to create (min 1)',
            items: {
              type: 'object',
              required: [
                'checklistTemplateId',
                'patientId',
                'caregiverProfileId',
                'type',
                'startDate',
                'endDate',
              ],
              properties: {
                checklistTemplateId: {
                  type: 'string',
                  description: 'ID of the checklist template to assign',
                  example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                },
                patientId: {
                  type: 'string',
                  description: 'ID of the patient',
                  example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
                },
                caregiverProfileId: {
                  type: 'string',
                  description:
                    'Caregiver profile ID (must be assigned to the patient)',
                  example: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
                },
                type: {
                  type: 'string',
                  enum: CHECKLIST_ASSIGNMENT_TYPES_VALUES,
                  description: 'Assignment frequency type',
                  example: 'DAILY',
                },
                startDate: {
                  type: 'string',
                  format: 'date',
                  description: 'Assignment start date (date-only)',
                  example: '2026-03-20',
                },
                endDate: {
                  type: 'string',
                  format: 'date',
                  description:
                    'Assignment end date (date-only, must be after start date)',
                  example: '2026-04-20',
                },
                notes: {
                  type: 'string',
                  description:
                    'Optional assignment notes or instructions (max 5000 chars)',
                  example:
                    'Please complete this checklist every morning before 10 AM.',
                },
              },
            },
          },
        },
        required: ['assignments'],
      },
      responses: {
        201: {
          description: 'Checklist assignments created successfully',
          message: {
            description: 'Success message',
            example: 'Checklist assignments created successfully',
          },
          body: {
            description: 'Created assignments',
            type: 'object',
            properties: {
              assignments: {
                type: 'array',
                items: assignmentResponseSchema,
              },
            },
          },
        },
        400: {
          description:
            'Bad Request - Validation error, template not active, or caregiver not assigned to patient',
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {
          description:
            'Forbidden - Only admins and case managers can create assignments',
        },
        404: {description: 'Not Found - Template not found'},
        409: {
          description:
            'Conflict - An active assignment already exists for this caregiver, patient, and template',
        },
      },
    }),

    get: createSwaggerDocs({
      tags: ['Checklist Assignments'],
      summary: 'List checklist assignments',
      description:
        'Retrieves a paginated list of checklist assignments. Caregivers only see their own assignments. Admins, nurses, and case managers see all assignments. Supports filtering by patient, caregiver, and template.',
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
            enum: ['startDate', 'endDate', 'createdAt'],
          },
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
          schema: {type: 'string'},
          description: 'Filter by patient ID',
        },
        {
          in: 'query',
          name: 'caregiverProfileId',
          schema: {type: 'string'},
          description: 'Filter by caregiver profile ID',
        },
        {
          in: 'query',
          name: 'checklistTemplateId',
          schema: {type: 'string'},
          description: 'Filter by checklist template ID',
        },
      ],
      responses: {
        200: {
          description: 'Assignments list retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Checklist assignments list retrieved successfully',
          },
          body: {
            description: 'List of assignments with pagination',
            type: 'object',
            properties: {
              assignments: {
                type: 'array',
                items: assignmentResponseSchema,
              },
              meta: paginationMeta,
            },
          },
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Insufficient permissions'},
      },
    }),
  },

  '/api/v1/assessments/assignments/{id}': {
    get: createSwaggerDocs({
      tags: ['Checklist Assignments'],
      summary: 'Get checklist assignment details',
      description:
        'Retrieves detailed information about a specific checklist assignment including template, patient, caregiver, and assigner details. Caregivers can only view their own assignments.',
      parameters: [
        createIdPathParam({
          name: 'id',
          description: 'Checklist Assignment ID',
        }),
      ],
      responses: {
        200: {
          description: 'Assignment retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Checklist assignment retrieved successfully',
          },
          body: {
            description: 'Assignment details',
            type: 'object',
            properties: {
              assignment: assignmentResponseSchema,
            },
          },
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Insufficient permissions'},
        404: {description: 'Not Found - Assignment not found'},
      },
    }),

    delete: createSwaggerDocs({
      tags: ['Checklist Assignments'],
      summary: 'Delete a checklist assignment (admin only)',
      description:
        'Soft deletes a checklist assignment. Only admins can delete.',
      parameters: [
        createIdPathParam({
          name: 'id',
          description: 'Checklist Assignment ID',
        }),
      ],
      responses: {
        200: {
          description: 'Assignment deleted successfully',
          message: {
            description: 'Success message',
            example: 'Checklist assignment deleted successfully',
          },
        },
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Only admins can delete assignments'},
        404: {description: 'Not Found - Assignment not found'},
      },
    }),
  },
};
