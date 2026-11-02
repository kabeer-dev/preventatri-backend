const {
  createSwaggerDocs,
  createIdPathParam,
} = require('../../utils/swaggerUtils');

// Common county schema
const countySchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'Unique identifier of the county',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    name: {
      type: 'string',
      description: 'County name',
      example: 'Adams',
    },
    stateCode: {
      type: 'string',
      nullable: true,
      description: 'Two-letter state; null on counties created before FIPS',
      example: 'PA',
    },
    fipsCode: {
      type: 'string',
      nullable: true,
      description: '5-digit Census county code, unique nationwide',
      example: '42001',
    },
    regionId: {
      type: 'string',
      description: 'Region ID the county belongs to',
      example: '550e8400-e29b-41d4-a716-446655440001',
    },
    organizationId: {
      type: 'string',
      description: 'Organization ID the county belongs to',
      example: '550e8400-e29b-41d4-a716-446655440002',
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      description: 'Creation timestamp',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      description: 'Last update timestamp',
    },
  },
};

// County with region relation (for GET /counties/:id)
const countyWithRegionSchema = {
  type: 'object',
  properties: {
    id: countySchema.properties.id,
    name: countySchema.properties.name,
    stateCode: countySchema.properties.stateCode,
    fipsCode: countySchema.properties.fipsCode,
    regionId: countySchema.properties.regionId,
    organizationId: countySchema.properties.organizationId,
    createdAt: countySchema.properties.createdAt,
    updatedAt: countySchema.properties.updatedAt,
    region: {
      type: 'object',
      description: 'Parent region',
      properties: {
        id: {type: 'string'},
        name: {type: 'string', example: 'Southeast Pennsylvania'},
        code: {type: 'string', example: 'SOUTHEAST_PENNSYLVANIA'},
      },
    },
  },
};

module.exports = {
  '/api/v1/counties/reference': {
    get: createSwaggerDocs({
      tags: ['Counties'],
      summary: 'List US counties available to add to a region',
      description:
        'Searches the US county reference data (every state). Not organization data: it lists the counties an admin can pick when creating or editing a region.',
      parameters: [
        {
          in: 'query',
          name: 'search',
          schema: {type: 'string'},
          description: 'Matches the county name and state, e.g. "wash pa"',
          example: 'Washington',
        },
        {
          in: 'query',
          name: 'stateCode',
          schema: {type: 'string'},
          description: 'Two-letter state filter',
          example: 'PA',
        },
        {
          in: 'query',
          name: 'page',
          schema: {type: 'integer'},
          description: 'Page number for pagination (default: 1)',
          example: 1,
        },
        {
          in: 'query',
          name: 'limit',
          schema: {type: 'integer'},
          description: 'Number of items per page (default: 25, max: 100)',
          example: 25,
        },
      ],
      responses: {
        200: {
          description: 'Reference counties retrieved successfully',
          schema: {
            type: 'object',
            properties: {
              counties: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    fipsCode: {type: 'string', example: '42125'},
                    stateCode: {type: 'string', example: 'PA'},
                    name: {type: 'string', example: 'Washington'},
                  },
                },
              },
              meta: {
                type: 'object',
                properties: {
                  page: {type: 'integer', example: 1},
                  limit: {type: 'integer', example: 25},
                  count: {type: 'integer', example: 31},
                  totalPages: {type: 'integer', example: 2},
                },
              },
            },
          },
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
      },
    }),
  },
  '/api/v1/counties': {
    get: createSwaggerDocs({
      tags: ['Counties'],
      summary: 'List all counties in organization',
      description:
        'Retrieves a paginated list of all counties in the current organization. Supports filtering by active status and region, with sorting and pagination options.',
      parameters: [
        {
          in: 'query',
          name: 'page',
          schema: {type: 'integer'},
          description: 'Page number for pagination (default: 1)',
          example: 1,
        },
        {
          in: 'query',
          name: 'limit',
          schema: {type: 'integer'},
          description: 'Number of items per page (default: 25, max: 100)',
          example: 25,
        },
        {
          in: 'query',
          name: 'sortBy',
          schema: {
            type: 'string',
            enum: ['name', 'createdAt'],
          },
          description: 'Field to sort by',
          example: 'name',
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
          name: 'regionId',
          schema: {type: 'string', format: 'uuid'},
          description: 'Filter by region ID',
        },
      ],
      responses: {
        200: {
          description: 'Counties retrieved successfully',
          message: {
            description: 'A message describing the result',
            example: 'Counties list retrieved successfully',
          },
          body: {
            description: 'List of counties with pagination metadata',
            type: 'object',
            properties: {
              counties: {
                type: 'array',
                items: countySchema,
              },
              meta: {
                type: 'object',
                properties: {
                  page: {type: 'integer', example: 1},
                  limit: {type: 'integer', example: 25},
                  count: {type: 'integer', example: 15},
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

  '/api/v1/counties/regions/{regionId}': {
    get: createSwaggerDocs({
      tags: ['Counties'],
      summary: 'Get counties by region',
      description:
        'Retrieves all active counties assigned to a specific region. Verifies the region exists before fetching counties.',
      parameters: [
        createIdPathParam({name: 'regionId', description: 'Region ID'}),
      ],
      responses: {
        200: {
          description: 'Counties retrieved successfully',
          message: {
            description: 'A message describing the result',
            example: 'Counties list retrieved successfully',
          },
          body: {
            description: 'List of active counties in the region',
            type: 'object',
            properties: {
              counties: {
                type: 'array',
                items: countySchema,
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
          description: 'Not Found - Region not found',
        },
      },
    }),
  },

  '/api/v1/counties/{id}': {
    get: createSwaggerDocs({
      tags: ['Counties'],
      summary: 'Get county details',
      description:
        'Retrieves detailed information about a specific county, including its parent region.',
      parameters: [createIdPathParam({name: 'id', description: 'County ID'})],
      responses: {
        200: {
          description: 'County retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Data retrieved successfully',
          },
          body: {
            description: 'County details with region information',
            type: 'object',
            properties: {
              county: countyWithRegionSchema,
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
          description: 'Not Found - County not found',
        },
      },
    }),
  },
};
