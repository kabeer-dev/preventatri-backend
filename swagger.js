const fs = require('fs');
const path = require('path');

const config = require('config');

const {PLATFORMS} = require('./constants/generalConstant');

const {
  PROJECT_DESCRIPTION,
  OPENAPI_VERSION,
  PROJECT_TITLE,
  PROJECT_VERSION,
} = require('./constants/swaggerConstants');
const {getValuesFromObj, safeMerge} = require('./utils');
const {getTokenHeaderName} = require('./utils/getTokenHeaderUtils');

const platformHeader = config.get('platformHeader');

function loadSwaggerDocs() {
  const routesDir = path.join(__dirname, 'routes');
  const platformsList = getValuesFromObj({obj: PLATFORMS, key: 'value'});
  let paths = {};

  fs.readdirSync(routesDir).forEach((folder) => {
    const docPath = path.join(routesDir, folder, 'docs.js');
    if (fs.existsSync(docPath)) {
      const doc = require(docPath);
      paths = safeMerge({originalObj: paths, newObj: doc});
    }
  });

  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: PROJECT_TITLE,
      version: PROJECT_VERSION,
      description: PROJECT_DESCRIPTION,
    },
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: getTokenHeaderName(),
        },
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token',
        },
      },
      parameters: {
        platformHeader: {
          name: platformHeader,
          in: 'header',
          description: "Platform type (e.g., 'web', 'mobile')",
          required: false,
          schema: {
            type: 'string',
            enum: platformsList,
            default: PLATFORMS.web.value,
          },
        },
      },
    },
    paths,
  };
}

module.exports = loadSwaggerDocs;
