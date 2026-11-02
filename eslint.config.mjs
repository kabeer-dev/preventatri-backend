import js from '@eslint/js';
import {defineConfig} from 'eslint/config';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

import enforceLibWrappers from './eslint-rules/enforceLibWrappers.js';
import enforceRouteOrder from './eslint-rules/enforceRouteOrder.js';
import enforceSingleObjectParam from './eslint-rules/enforceSingleObjectParam.js';
import noSpreadOperator from './eslint-rules/noSpreadOperator.js';

// Each library may only be required in its wrapper file (enforce-lib-wrappers)

const LIB_WRAPPERS = {
  luxon: 'utils/dateUtils.js',
  jsonwebtoken: 'utils/jwtUtils.js',
  twilio: 'utils/phone/send.js',
  resend: 'utils/email/send.js',
  ioredis: 'lib/redis/index.js',
  handlebars: 'utils/email/utils.js',
  multer: 'middleware/fileUploadMiddleware.js',
  winston: 'middleware/loggerMiddleware.js',
  'winston-transport-sentry-node': 'middleware/loggerMiddleware.js',
  'express-rate-limit': 'middleware/ddosProtectionMiddleware.js',
  'fast-xml-parser': 'utils/hhaExchange/soapClient.js',
  'socket.io': 'socketInstance.js',
};

export default defineConfig([
  {ignores: ['generated/**', 'node_modules/**']},
  // The agent config folder holds plain helper scripts, not app code
  {ignores: ['.claude/**']},
  {files: ['**/*.{js,mjs,cjs}']},
  {files: ['**/*.js'], languageOptions: {sourceType: 'commonjs'}},
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        process: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ignores: ['**/*.test.js'],
    plugins: {
      js,
      import: importPlugin,
      'local-rules': {
        rules: {
          'enforce-single-object-param': enforceSingleObjectParam,
          'enforce-route-order': enforceRouteOrder,
          'no-spread-operator': noSpreadOperator,
          'enforce-lib-wrappers': enforceLibWrappers,
        },
      },
    },

    extends: ['js/recommended'],
    rules: {
      'no-console': ['error', {allow: ['warn', 'error']}],

      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling', 'index'],
          ],
          pathGroups: [
            {pattern: 'react', group: 'external', position: 'before'},
            {pattern: './**', group: 'internal'},
            {pattern: '../**', group: 'internal'},
          ],
          pathGroupsExcludedImportTypes: ['react'],
          'newlines-between': 'always-and-inside-groups',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],

      // Add new line above comment
      'lines-around-comment': [
        'error',
        {
          beforeLineComment: true,
          beforeBlockComment: true,
          allowBlockStart: true,
          allowClassStart: true,
          allowObjectStart: true,
          allowArrayStart: true,
        },
      ],

      // Add new line above return
      'newline-before-return': 'error',

      // Add new line below import
      'import/newline-after-import': [
        'error',
        {
          count: 1,
        },
      ],

      // Add new line after each var, const, let declaration
      'padding-line-between-statements': [
        'error',
        {blankLine: 'always', prev: ['export'], next: ['*']},
        {
          blankLine: 'always',
          prev: ['*'],
          next: ['multiline-const', 'multiline-let', 'multiline-var', 'export'],
        },
      ],
      'no-unused-vars': [
        'error',
        {
          vars: 'all',
          args: 'none',
          caughtErrors: 'none',
          ignoreRestSiblings: false,
          reportUsedIgnorePattern: false,
        },
      ],

      'local-rules/enforce-single-object-param': ['error'],
      'local-rules/enforce-route-order': ['error'],
      'local-rules/no-spread-operator': ['error'],
      'local-rules/enforce-lib-wrappers': ['error', {wrappers: LIB_WRAPPERS}],
    },
  },

  // Disable for middleware only
  {
    files: [
      '**/middleware.js',
      '**/middleware/**/*.js',
      '**/controllers.js',
      '**/controllers/**/*.js',
      '**/models/plugins/*.js',
    ],
    rules: {
      'local-rules/enforce-single-object-param': 'off',
    },
  },

  // Disable no-spread-operator for eslint.config.mjs
  {
    files: ['eslint.config.mjs'],
    rules: {
      'local-rules/no-spread-operator': 'off',
    },
  },
]);
