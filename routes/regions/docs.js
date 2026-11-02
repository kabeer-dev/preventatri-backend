const {
  createSwaggerDocs,
  createIdPathParam,
} = require('../../utils/swaggerUtils');

// Common region schema
const regionSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'Unique identifier of the region',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    name: {
      type: 'string',
      description: 'Display name of the region',
      example: 'Southeast Pennsylvania',
    },
    code: {
      type: 'string',
      description: 'Unique code for the region',
      example: 'SOUTHEAST_PENNSYLVANIA',
    },
    organizationId: {
      type: 'string',
      description: 'Organization ID the region belongs to',
      example: '550e8400-e29b-41d4-a716-446655440001',
    },
    isActive: {
      type: 'boolean',
      description: 'Whether the region is active',
      example: true,
    },
    counties: {
      type: 'array',
      description: 'Counties assigned to this region',
      items: {
        type: 'object',
        properties: {
          id: {type: 'string', description: 'County ID'},
          name: {type: 'string', example: 'Adams'},
          stateCode: {type: 'string', nullable: true, example: 'PA'},
          fipsCode: {type: 'string', nullable: true, example: '42001'},
          isActive: {type: 'boolean', example: true},
        },
      },
    },
    primaryNurses: {
      type: 'array',
      description: 'Primary nurses assigned to this region',
      items: {
        type: 'object',
        properties: {
          id: {type: 'string', description: 'Nurse profile ID'},
          status: {
            type: 'string',
            description: 'Nurse status',
            example: 'ACTIVE',
          },
          user: {
            type: 'object',
            properties: {
              id: {type: 'string'},
              firstName: {type: 'string'},
              lastName: {type: 'string'},
              email: {type: 'string'},
              isVerified: {type: 'boolean'},
            },
          },
        },
      },
    },
    secondaryNurses: {
      type: 'array',
      description: 'Secondary nurses assigned to this region',
      items: {
        type: 'object',
        properties: {
          id: {type: 'string', description: 'Nurse profile ID'},
          status: {
            type: 'string',
            description: 'Nurse status',
            example: 'ACTIVE',
          },
          user: {
            type: 'object',
            properties: {
              id: {type: 'string'},
              firstName: {type: 'string'},
              lastName: {type: 'string'},
              email: {type: 'string'},
              isVerified: {type: 'boolean'},
            },
          },
        },
      },
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

// Region with nurse count schema
const regionSummarySchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'Unique identifier of the region',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    name: {
      type: 'string',
      description: 'Display name of the region',
      example: 'Southeast Pennsylvania',
    },
    code: {
      type: 'string',
      description: 'Unique code for the region',
      example: 'SOUTHEAST_PENNSYLVANIA',
    },
    isActive: {
      type: 'boolean',
      description: 'Whether the region is active',
      example: true,
    },
    nurseCount: {
      type: 'integer',
      description: 'Number of nurses assigned to this region',
      example: 5,
    },
  },
};

module.exports = {
  '/api/v1/regions': {
    get: createSwaggerDocs({
      tags: ['Regions'],
      summary: 'List all regions in organization',
      description:
        'Retrieves a paginated list of all regions in the current organization with filtering and sorting options',
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
            enum: ['name', 'code', 'isActive', 'createdAt'],
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
          name: 'isActive',
          schema: {type: 'string', enum: ['true', 'false']},
          description: 'Filter by active status',
          example: 'true',
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
            'Archive view: active (default) hides archived regions, all returns both, archived returns only archived. Each region carries an archived flag.',
        },
      ],
      responses: {
        200: {
          description: 'Regions retrieved successfully',
          message: {
            description: 'A message describing the result',
            example: 'Regions retrieved successfully',
          },
          body: {
            description: 'List of regions with pagination metadata',
            type: 'object',
            properties: {
              regions: {
                type: 'array',
                items: regionSchema,
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
      },
    }),

    post: createSwaggerDocs({
      tags: ['Regions'],
      summary: 'Create a new region',
      description:
        'Creates a new region in the organization with optional counties, given as FIPS codes from GET /counties/reference. If counties are provided, they are created atomically alongside the region. Code is auto-generated from name if not provided. (Admin only)',
      requestBody: {
        fields: {
          name: {
            type: 'string',
            description: 'Display name of the region',
            example: 'Southeast Pennsylvania',
          },
          code: {
            type: 'string',
            description:
              'Unique code (uppercase letters, numbers, underscores). Auto-generated from name if omitted.',
            example: 'SOUTHEAST_PENNSYLVANIA',
          },
          isActive: {
            type: 'boolean',
            description: 'Whether the region is active (default: true)',
            example: true,
          },
          counties: {
            type: 'array',
            description:
              'Counties to create alongside the region, each by its FIPS code',
            items: {
              type: 'object',
              properties: {fipsCode: {type: 'string'}},
            },
            example: [{fipsCode: '42001'}, {fipsCode: '42133'}],
          },
        },
        required: ['name'],
      },
      responses: {
        201: {
          description: 'Region created successfully',
          message: {
            description: 'Success message',
            example: 'Region created successfully',
          },
          body: {
            description: 'Created region',
            type: 'object',
            properties: {
              region: regionSchema,
            },
          },
        },
        400: {
          description: 'Bad Request - Validation error',
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Insufficient permissions',
        },
        409: {
          description: 'Conflict - Region code already exists',
        },
      },
    }),
  },

  '/api/v1/regions/summary': {
    get: createSwaggerDocs({
      tags: ['Regions'],
      summary: 'Get regions summary with nurse counts',
      description:
        'Retrieves all active regions with the count of nurses assigned to each. This endpoint requires admin permissions.',
      responses: {
        200: {
          description: 'Regions summary retrieved successfully',
          message: {
            description: 'A message describing the result',
            example: 'Regions summary retrieved successfully',
          },
          body: {
            description: 'List of regions with nurse counts',
            type: 'object',
            properties: {
              regionsSummary: {
                type: 'array',
                items: regionSummarySchema,
              },
            },
          },
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Insufficient permissions (Admin only)',
        },
      },
    }),
  },

  '/api/v1/regions/{id}': {
    get: createSwaggerDocs({
      tags: ['Regions'],
      summary: 'Get region details',
      description: 'Retrieves detailed information about a specific region',
      parameters: [createIdPathParam({name: 'id', description: 'Region ID'})],
      responses: {
        200: {
          description: 'Region retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Region retrieved successfully',
          },
          body: {
            description: 'Region details',
            type: 'object',
            properties: {
              region: regionSchema,
            },
          },
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        404: {
          description: 'Not Found - Region not found',
        },
      },
    }),

    patch: createSwaggerDocs({
      tags: ['Regions'],
      summary: 'Update region',
      description:
        'Updates region information and optionally manages counties. When counties array is provided, it performs a diff: new counties are created, counties no longer in the list are hard-deleted (fails if they have patients assigned). (Admin only)',
      parameters: [createIdPathParam({name: 'id', description: 'Region ID'})],
      requestBody: {
        fields: {
          name: {
            type: 'string',
            description: 'Display name of the region',
            example: 'Southeast PA Updated',
          },
          code: {
            type: 'string',
            description:
              'Unique code (uppercase letters, numbers, underscores)',
            example: 'SOUTHEAST_PENNSYLVANIA_V2',
          },
          isActive: {
            type: 'boolean',
            description: 'Whether the region is active',
            example: true,
          },
          counties: {
            type: 'array',
            description:
              'Full list of counties, each as {fipsCode} or {id} of a county the region already has. Computes diff against current counties: new ones are created, missing ones are removed.',
            items: {
              type: 'object',
              properties: {
                fipsCode: {type: 'string'},
                id: {type: 'string'},
              },
            },
            example: [{fipsCode: '42001'}, {id: 'existing-county-uuid'}],
          },
        },
        required: [],
      },
      responses: {
        200: {
          description: 'Region updated successfully',
          message: {
            description: 'Success message',
            example: 'Region updated successfully',
          },
          body: {
            description: 'Updated region',
            type: 'object',
            properties: {
              region: regionSchema,
            },
          },
        },
        400: {
          description: 'Bad Request - Validation error',
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
        409: {
          description: 'Conflict - Region code already exists',
        },
      },
    }),

    delete: createSwaggerDocs({
      tags: ['Regions'],
      summary: 'Delete region (soft delete)',
      description:
        'Soft deletes a region. Cannot delete regions with nurses assigned.',
      parameters: [createIdPathParam({name: 'id', description: 'Region ID'})],
      responses: {
        200: {
          description: 'Region deleted successfully',
          message: {
            description: 'Success message',
            example: 'Region deleted successfully',
          },
        },
        400: {
          description:
            'Bad Request - Cannot delete region with nurses assigned',
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

  '/api/v1/regions/{id}/nurses': {
    get: createSwaggerDocs({
      tags: ['Regions'],
      summary: 'Get nurses in a region',
      description: 'Retrieves all nurses assigned to a specific region',
      parameters: [createIdPathParam({name: 'id', description: 'Region ID'})],
      responses: {
        200: {
          description: 'Region nurses retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Region nurses retrieved successfully',
          },
          body: {
            description: 'Region with assigned nurses',
            type: 'object',
            properties: {
              regionNurses: {
                type: 'object',
                properties: {
                  region: {
                    type: 'object',
                    properties: {
                      id: {type: 'string'},
                      name: {type: 'string'},
                      code: {type: 'string'},
                    },
                  },
                  nurses: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        nurseProfileId: {type: 'string'},
                        userId: {type: 'string'},
                        isPrimaryForRegion: {type: 'boolean'},
                        assignedAt: {type: 'string', format: 'date-time'},
                        user: {
                          type: 'object',
                          properties: {
                            id: {type: 'string'},
                            firstName: {type: 'string'},
                            lastName: {type: 'string'},
                            email: {type: 'string'},
                            phoneNo: {type: 'string'},
                          },
                        },
                        professionalRole: {type: 'string', enum: ['RN', 'LPN']},
                        status: {type: 'string', enum: ['ACTIVE', 'INACTIVE']},
                      },
                    },
                  },
                  nurseCount: {type: 'integer', example: 5},
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
          description: 'Not Found - Region not found',
        },
      },
    }),
  },
};
