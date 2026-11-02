const {
  GLOBAL_SEARCH_LIMITS,
  GLOBAL_SEARCH_RESULT_TYPES,
  GLOBAL_SEARCH_STAFF_ROLES,
} = require('../../constants/globalSearchConstants');
const {createSwaggerDocs} = require('../../utils/swaggerUtils');

const searchResultSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description:
        'Patient id, or the role profile id for staff (the id their detail page uses)',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    type: {
      type: 'string',
      enum: [GLOBAL_SEARCH_RESULT_TYPES.patient].concat(
        GLOBAL_SEARCH_STAFF_ROLES
      ),
      example: 'nurse',
    },
    firstName: {type: 'string', nullable: true, example: 'Priya'},
    lastName: {type: 'string', nullable: true, example: 'Raman'},
    email: {
      type: 'string',
      nullable: true,
      description: 'Staff only; null for patients',
      example: 'priya.raman@example.com',
    },
    location: {
      type: 'string',
      nullable: true,
      description:
        "Patients only: the county's region name, falling back to the county name; null for staff",
      example: 'Sussex County',
    },
  },
};

module.exports = {
  '/api/v1/search': {
    get: createSwaggerDocs({
      tags: ['Global Search'],
      summary: 'Search patients and staff',
      description: `Searches patients by first or last name, and nurses, caregivers and case managers by first name, last name or email, within the caller's active organization. Returns only the fields a search suggestion displays. Patients are listed before staff, and each group is capped by limit. Archived patients and deleted users are excluded. Admin only.`,
      parameters: [
        {
          in: 'query',
          name: 'search',
          required: true,
          schema: {
            type: 'string',
            minLength: GLOBAL_SEARCH_LIMITS.minChars,
            maxLength: 200,
          },
          description:
            'Search text. Every word must match one of the searched fields.',
          example: 'priya',
        },
        {
          in: 'query',
          name: 'limit',
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: GLOBAL_SEARCH_LIMITS.maxLimit,
            default: GLOBAL_SEARCH_LIMITS.defaultLimit,
          },
          description: 'Maximum results per group (patients, staff).',
        },
      ],
      responses: {
        200: {
          description: 'Search results retrieved successfully',
          message: {
            description: 'A message describing the result',
            example: 'Search results retrieved successfully',
          },
          body: {
            description: 'Matching patients followed by matching staff',
            type: 'object',
            properties: {
              results: {type: 'array', items: searchResultSchema},
              type: {
                type: 'string',
                example: 'GLOBAL_SEARCH_RESULTS_RETRIEVED',
              },
            },
          },
        },
        400: {description: 'Bad request - Invalid query parameters'},
        401: {description: 'Unauthorized - Invalid or missing token'},
        403: {description: 'Forbidden - Caller is not an admin'},
      },
    }),
  },
};
