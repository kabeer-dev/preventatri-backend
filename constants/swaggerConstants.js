const PROJECT_TITLE = 'Backend Boilerplate';
const PROJECT_DESCRIPTION = 'A boilerplate for backend development';
const PROJECT_VERSION = '1.0.0';
const OPENAPI_VERSION = '3.0.0';
const API_PREFIX = '/api/v1/';
const JSON_CONTENT_TYPE = 'application/json';

const SWAGGER_PLATFORM_HEADER_REF = {
  $ref: '#/components/parameters/platformHeader',
};

const SWAGGER_SECURITY_SCHEMES = [{cookieAuth: []}, {bearerAuth: []}];

const DEFAULT_HTTP_STATUS_CODE_DESCRIPTION = 'HTTP status code';

const DEFAULT_MESSAGE_DESCRIPTION = 'Response message';

const DEFAULT_RESPONSE_DESCRIPTION = 'Response description';

const SCHEMA_TYPES = {
  object: 'object',
  array: 'array',
  string: 'string',
  integer: 'integer',
  boolean: 'boolean',
};

module.exports = {
  PROJECT_TITLE,
  PROJECT_DESCRIPTION,
  PROJECT_VERSION,
  OPENAPI_VERSION,
  API_PREFIX,
  JSON_CONTENT_TYPE,
  SWAGGER_PLATFORM_HEADER_REF,
  SWAGGER_SECURITY_SCHEMES,
  DEFAULT_HTTP_STATUS_CODE_DESCRIPTION,
  DEFAULT_MESSAGE_DESCRIPTION,
  SCHEMA_TYPES,
  DEFAULT_RESPONSE_DESCRIPTION,
};
