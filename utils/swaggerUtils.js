const {safeMerge} = require('./general');

const {
  JSON_CONTENT_TYPE,
  SWAGGER_PLATFORM_HEADER_REF,
  SWAGGER_SECURITY_SCHEMES,
  DEFAULT_HTTP_STATUS_CODE_DESCRIPTION,
  DEFAULT_MESSAGE_DESCRIPTION,
  SCHEMA_TYPES,
  DEFAULT_RESPONSE_DESCRIPTION,
} = require('../constants/swaggerConstants');

/**
 * Builds a Swagger-compatible requestBody object.
 *
 * @param {Object} requestBody - Object containing fields and required fields.
 * @param {Object} requestBody.fields - Field definitions.
 * @param {Array<string>} [requestBody.required=[]] - List of required field names.
 * @param {string} [requestBody.schemaType='object'] - Schema type (e.g. 'object', 'array').
 * @param {string} [requestBody.contentType='application/json'] - Content type of the request.
 * @returns {Object} Swagger requestBody object.
 *
 * @example
 * buildRequestBody({
 *   requestBody: {
 *     fields: {
 *       email: { type: 'string', example: 'user@example.com' },
 *       password: { type: 'string', example: '123456' },
 *     },
 *     required: ['email', 'password'],
 *     contentType: 'application/json',
 *     schemaType: 'object',
 *   },
 * });
 */
const buildRequestBody = ({requestBody}) => {
  const {
    fields,
    required = [],
    schemaType = SCHEMA_TYPES.object,
    contentType = JSON_CONTENT_TYPE,
  } = requestBody;

  return {
    required: true,
    content: {
      [contentType]: {
        schema: {
          type: schemaType,
          properties: fields,
          required,
        },
      },
    },
  };
};

// Common reusable 500 response
const defaultInternalServerError = {
  description: 'Internal Server Error',
  message: {
    description: 'Error message',
    example: 'Internal server error',
  },
};

/**
 * Builds Swagger-compatible response definitions for API documentation.
 *
 * @param {Object} params - The parameters object.
 * @param {Object} params.responses - Response definitions keyed by HTTP status code.
 * Each response entry describes what the API returns for that status.
 * @returns {Object} Swagger-compatible `responses` object suitable for inclusion in API docs.
 *
 * @example
 * buildResponses({
 *   responses: {
 *     200: {
 *       description: 'Successful operation',
 *       statusCode: { description: 'HTTP status code'},
 *       message: { description: 'Success message', example: 'User created successfully' },
 *       body: {
 *         description: 'Main response body',
 *         type: 'object',
 *         properties: {
 *           id: { type: 'string', example: '123abc' },
 *           name: { type: 'string', example: 'John Doe' },
 *         },
 *       },
 *     },
 *     400: {
 *       description: 'Bad Request',
 *       statusCode: { description: 'HTTP status code'},
 *       message: { description: 'Error message', example: 'Invalid input' },
 *     },
 *   },
 * });
 */
const buildResponses = ({responses}) => {
  const built = {};
  const includes500Error = responses[500];

  // If no 500 response, then just added it to the array so it gets processed
  if (!includes500Error) responses[500] = defaultInternalServerError;

  for (const [statusCode, responseDefinition] of Object.entries(responses)) {
    const {description, message, body} = responseDefinition;

    const properties = safeMerge({
      originalObj: {
        statusCode: {
          type: SCHEMA_TYPES.integer,
          description: DEFAULT_HTTP_STATUS_CODE_DESCRIPTION,
          example: statusCode,
        },
      },
      newObj: safeMerge({
        originalObj: message
          ? {
              message: {
                type: SCHEMA_TYPES.string,
                description: message.description || DEFAULT_MESSAGE_DESCRIPTION,
                example: message.example,
              },
            }
          : {},
        newObj: body
          ? {
              body: safeMerge({
                originalObj: {
                  type: body.type || SCHEMA_TYPES.object,
                  description: body.description || DEFAULT_RESPONSE_DESCRIPTION,
                },
                newObj: body.properties ? {properties: body.properties} : {},
              }),
            }
          : {},
      }),
    });

    built[statusCode] = {
      description: description || '',
      content: {
        [JSON_CONTENT_TYPE]: {
          schema: {
            type: SCHEMA_TYPES.object,
            properties,
          },
        },
      },
    };
  }

  return built;
};

/**
 * Builds the Swagger documentation object for a given endpoint.
 *
 * @param {Object} options - Options describing the endpoint.
 * @param {Array<string>} [options.tags] - Tags categorizing the endpoint.
 * @param {string} [options.summary] - A short summary for the endpoint.
 * @param {string} [options.description] - A detailed description for the endpoint.
 * @param {Object} [options.requestBody] - Contains fields, required, schemaType, and contentType.
 * @param {Object} [options.responses] - Swagger responses definition.
 * @param {boolean} [options.isAuthorizedEndpoint=true] - Whether the endpoint requires authorization using the default security scheme.
 * @param {Array<Object>} [options.parameters=[]] - Additional Swagger parameters to include before the platform header.
 * @returns {Object} Swagger schema definition for the HTTP method.
 */
const createSwaggerDocs = ({
  tags,
  summary,
  description,
  requestBody,
  responses,
  isAuthorizedEndpoint = true,
  parameters = [],
}) => {
  const doc = {
    parameters: parameters.concat([SWAGGER_PLATFORM_HEADER_REF]),
  };
  if (tags) doc.tags = tags;

  if (summary) doc.summary = summary;

  if (description) doc.description = description;

  // 🔐 Handle authorization/security
  if (isAuthorizedEndpoint) doc.security = SWAGGER_SECURITY_SCHEMES;

  // 🧩 Handle requestBody if provided
  if (requestBody) doc.requestBody = buildRequestBody({requestBody});

  // 💡 Use buildResponses automatically
  doc.responses = responses ? buildResponses({responses}) : {};

  return doc;
};

/**
 * Creates a reusable Swagger path parameter for an ID.
 *
 * @param {Object} [options] - Parameter options.
 * @param {string} [options.name='id'] - Parameter name.
 * @param {string} [options.description='The unique ID of the resource'] - Parameter description.
 * @returns {Object} Swagger path parameter object.
 */
const createIdPathParam = ({
  name = 'id',
  description = 'The unique ID of the resource',
} = {}) => ({
  in: 'path',
  name,
  required: true,
  schema: {type: 'string'},

  // schema: {type: 'string', pattern: '^[a-fA-F0-9]{24}$'},
  description,
});

module.exports = {
  createSwaggerDocs,
  createIdPathParam,
};
