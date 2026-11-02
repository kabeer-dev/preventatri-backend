const crypto = require('crypto');

const config = require('config');
const mongoose = require('mongoose');

const {errorsConstants} = require('../constants');

const {
  DEFAULT_SECRET_KEYS,
  DEFAULT_OTPS,
} = require('../constants/generalConstant');
const {DEFAULT_LANGUAGE} = require('../constants/usersConstants');
const AppError = require('../factories/errors/app');

module.exports.isEnvProd =
  config.get('env') === config.get('envVariables.prod');

module.exports.isEnvDev = config.get('env') === config.get('envVariables.dev');

module.exports.corsOrigins = this.isEnvProd
  ? config.get('allowedOrigins').split(',')
  : true;

module.exports.createOptions = ({
  extraQueries = null,
  originalOptions = {},
}) => {
  return Object.assign({}, originalOptions, {extraQueries});
};

const isValidObjectId = ({id}) => {
  return typeof id === 'string' && mongoose.Types.ObjectId.isValid(id);
};

module.exports.convertMongoIdsInQuery = ({query = {}}) => {
  const newQuery = {};

  for (const key in query) {
    const value = query[key];

    if (Array.isArray(value?.$in)) {
      newQuery[key] = {
        $in: value.$in.map((v) =>
          isValidObjectId({id: v})
            ? mongoose.Types.ObjectId.createFromHexString(v)
            : v
        ),
      };
    } else if (isValidObjectId({id: value})) {
      newQuery[key] = mongoose.Types.ObjectId.createFromHexString(value);
    } else {
      newQuery[key] = value;
    }
  }

  return newQuery;
};

module.exports.checkErrorType = ({error}) => {
  const isAppError = error instanceof AppError;
  const isError = error instanceof Error;

  return {isAppError, isError};
};

module.exports.generateUrl = ({
  path = '',
  locale = DEFAULT_LANGUAGE,
  params = '',
}) => {
  const domain = config.get('frontendURL');
  const segments = [domain, locale, path, params].filter(Boolean);
  const url = segments.join('/');

  return url;
};

module.exports.getLocaleFromCookie = ({req}) => {
  return (
    req?.jwtToken?.user?.language ||
    req?.cookies?.[config.get('locale')] ||
    DEFAULT_LANGUAGE
  );
};

module.exports.isDocumentDuplicationError = ({error}) => {
  // MongoDB error code: 11000
  // Prisma error code: P2002
  return (
    error?.code === errorsConstants.MONGODB_DUPLICATION_ERROR_CODE ||
    error?.code === errorsConstants.PRISMA_DUPLICATION_ERROR_CODE
  );
};

module.exports.isPrismaKnownError = ({error}) => {
  if (error?.name !== errorsConstants.PRISMA_KNOWN_REQUEST_ERROR_NAME)
    return false;

  const knownCodes = [
    errorsConstants.PRISMA_DUPLICATION_ERROR_CODE,
    errorsConstants.PRISMA_NOT_FOUND_ERROR_CODE,
    errorsConstants.PRISMA_FOREIGN_KEY_ERROR_CODE,
    errorsConstants.PRISMA_REQUIRED_RELATION_ERROR_CODE,
    errorsConstants.PRISMA_VALUE_TOO_LONG_ERROR_CODE,
  ];

  return knownCodes.includes(error?.code);
};

module.exports.isDocumentNotFoundError = ({error}) => {
  // Prisma error code: P2025 (thrown by findFirstOrThrow and update when record not found)
  // Check both error.code and error.name for NotFoundError
  return (
    error?.code === errorsConstants.PRISMA_NOT_FOUND_ERROR_CODE ||
    error?.name === 'NotFoundError'
  );
};

module.exports.sleep = async ({time}) => {
  // eslint-disable-next-line local-rules/enforce-single-object-param
  return new Promise((resolve) => setTimeout(resolve, time));
};

exports.generateRandomString = ({length = 8, numericOnly = false} = {}) => {
  const chars = numericOnly
    ? '0123456789'
    : 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';

  return Array.from(crypto.randomBytes(length))
    .map((byte) => chars[byte % chars.length])
    .join('');
};

module.exports.convertSecondsToMinutes = ({seconds}) => {
  return Math.floor(seconds / 60);
};

/**
 * Extracts specific property values from an object of objects.
 *
 * @param {Object} params
 * @param {Object} params.obj - The source object.
 * @param {string} [params.key='value'] - The key to extract from each inner object.
 *
 * @returns {any[]} An array of extracted values.
 *
 * @example
 * const USER_ROLES = {
 *   admin: { value: 'admin', access: { dashboard: true } },
 *   user: { value: 'user', access: { dashboard: false } },
 * };
 *
 * getValuesFromObj({ obj: USER_ROLES });
 * // => ['admin', 'user']
 *
 * getValuesFromObj({ obj: USER_ROLES, key: 'access' });
 * // => [{ dashboard: true }, { dashboard: false }]
 */
module.exports.getValuesFromObj = ({obj = {}, key = 'value'}) => {
  return Object.values(obj).map((item) => item?.[key]);
};

module.exports.convertSecondsToMinutes = ({seconds}) => {
  return Math.floor(seconds / 60);
};

/**
 * Generate a region code from a region name
 * Converts "Southeast Pennsylvania" → "SOUTHEAST_PENNSYLVANIA"
 * Converts "Lehigh Valley / East Pennsylvania" → "LEHIGH_VALLEY_EAST_PENNSYLVANIA"
 * Strips non-alphanumeric chars (except spaces), uppercases, replaces spaces with underscores
 *
 * @param {Object} params
 * @param {string} params.name - The region name to convert
 * @returns {string} The generated code
 */
module.exports.generateRegionCode = ({name}) => {
  return name
    .replace(/[^a-zA-Z0-9\s]/g, '') // strip special chars (keep spaces)
    .trim()
    .replace(/\s+/g, '_') // spaces → underscores
    .toUpperCase();
};

/**
 * Smart merge utility that handles both simple and complex object merging
 *
 * @param {Object} params
 * @param {Object} params.originalObj - The base object to merge into
 * @param {Object} params.newObj - The new object to merge from
 * @param {boolean} [params.deep=false] - Whether to perform deep merge on nested objects
 *
 * @returns {Object} A new merged object
 *
 * @description
 * Behavior:
 * - Simple merge (deep=false, default): Fast shallow merge for flat objects
 * - Deep merge (deep=true): Recursively merges nested structures
 * - Arrays: Always combines and deduplicates values (Set behavior)
 * - Primitives: New value overrides original value
 *
 * WHEN TO USE SIMPLE (deep=false):
 * ✅ Flat objects with no nesting: {organizationId, entityToCheck, status}
 * ✅ Simple query parameters or filters
 * ✅ Performance-critical operations with shallow data
 * ✅ When you just need {...a, ...b} but with array deduplication
 *
 * WHEN TO USE DEEP (deep=true, default):
 * ✅ Nested configuration objects
 * ✅ Complex API responses with nested data
 * ✅ Swagger/OpenAPI definitions with nested parameters
 * ✅ Database options with nested extraQueries
 * ✅ Middleware data with complex structures
 *
 * @example
 * // Simple merge (fast, shallow)
 * safeMerge({
 *   originalObj: { organizationId: '123', status: 'active' },
 *   newObj: { entityToCheck: 'user' },
 *   deep: false
 * })
 * // Result: { organizationId: '123', status: 'active', entityToCheck: 'user' }
 *
 * @example
 * // Deep merge (nested structures)
 * safeMerge({
 *   originalObj: { api: { timeout: 3000, retry: { count: 3 } } },
 *   newObj: { api: { retry: { delay: 1000 } } }
 * })
 * // Result: { api: { timeout: 3000, retry: { count: 3, delay: 1000 } } }
 *
 * @example
 * // Array deduplication (works in both modes)
 * safeMerge({
 *   originalObj: { tags: ['a', 'b'] },
 *   newObj: { tags: ['b', 'c'] }
 * })
 * // Result: { tags: ['a', 'b', 'c'] }
 */

/* eslint-disable local-rules/no-spread-operator */
exports.safeMerge = ({originalObj = {}, newObj = {}, deep = false}) => {
  // Helper to check if value is a plain object
  // eslint-disable-next-line local-rules/enforce-single-object-param
  const isPlainObject = (val) =>
    val && typeof val === 'object' && !Array.isArray(val);

  // Simple shallow merge for performance
  if (!deep) {
    const result = {...originalObj};

    for (const key of Object.keys(newObj)) {
      const originalVal = originalObj?.[key];
      const newVal = newObj[key];

      // Arrays → merge unique values even in shallow mode
      if (Array.isArray(originalVal) && Array.isArray(newVal)) {
        result[key] = Array.from(new Set([...originalVal, ...newVal]));
      }

      // Otherwise → override with new value
      else {
        result[key] = newVal;
      }
    }

    return result;
  }

  // Deep merge for complex nested structures
  const result = {...originalObj};

  for (const key of Object.keys(newObj)) {
    const originalVal = originalObj?.[key];
    const newVal = newObj[key];

    // Both are objects → deep merge recursively
    if (isPlainObject(originalVal) && isPlainObject(newVal)) {
      result[key] = exports.safeMerge({
        originalObj: originalVal,
        newObj: newVal,
        deep: true,
      });
    }

    // Both are arrays → merge unique values
    else if (Array.isArray(originalVal) && Array.isArray(newVal)) {
      result[key] = Array.from(new Set([...originalVal, ...newVal]));
    }

    // Otherwise → override with new value
    else {
      result[key] = newVal;
    }
  }

  return result;
};
/* eslint-enable local-rules/no-spread-operator */

/**
 * Safe Array Concatenation
 * Merges arrays with automatic deduplication
 *
 * @param {Array} originalArray - First array to merge
 * @param {Array} newArray - Second array to merge
 * @returns {Array} - Merged array with unique values
 *
 * @example
 * safeConcat(['a', 'b'], ['b', 'c'])
 * // Result: ['a', 'b', 'c']
 *
 * @example
 * safeConcat([1, 2, 3], [3, 4, 5])
 * // Result: [1, 2, 3, 4, 5]
 */
exports.safeConcat = ({originalArray = [], newArray = []}) => {
  // Ensure both inputs are arrays
  const arr1 = Array.isArray(originalArray) ? originalArray : [];
  const arr2 = Array.isArray(newArray) ? newArray : [];

  // Concatenate and deduplicate using Set for primitive values
  // For complex objects, Set uses reference equality
  return Array.from(new Set(arr1.concat(arr2)));
};

// UTILITY: Get existing secret keys or use defaults to prevent data loss on partial updates
module.exports.getExistingSecretKeys = ({secretKeys}) => {
  return secretKeys || DEFAULT_SECRET_KEYS;
};

// UTILITY: Get existing otps or use defaults to prevent data loss on partial updates
module.exports.getExistingOtps = ({otps}) => {
  return otps || DEFAULT_OTPS;
};

/**
 * Extract values from an enumeration object
 * Used for creating list of valid values for enums
 * @param {Object} enumObject - Object with items that have a 'value' property
 * @returns {Array} Array of values
 */
module.exports.extractValuesFromObject = ({obj}) => {
  return Object.values(obj).map((item) => item.value);
};

/**
 * Get pagination parameters from request query
 * Get list query parameters from request
 * Extracts pagination, sorting, search, and date filters from query
 * Handles defaults and type conversions
 * @param {Object} req - Express request object
 * @returns {Object} {page, limit, skip, search, date, sortBy, sortDir}
 */
module.exports.getListParams = ({req}) => {
  const {generalConstant} = require('../constants');

  const page =
    parseInt(req.query.page, 10) || generalConstant.paginationDefaults.page;

  const limit =
    parseInt(req.query.limit, 10) || generalConstant.paginationDefaults.limit;

  const skip = (page - 1) * limit;
  const search = req.query?.search?.trim() || null;
  const date = req.query?.date || null;
  const sortBy = req.query?.sortBy || null;
  const sortDir = req.query?.sortDir || null;

  return {page, limit, skip, search, date, sortBy, sortDir};
};

/**
 * Appends an id tie-breaker to a Prisma orderBy, so offset pages over a
 * non-unique sort key (names) neither repeat nor skip rows.
 */
module.exports.withIdTieBreaker = ({orderBy}) =>
  orderBy ? [orderBy, {id: 'asc'}] : orderBy;

/**
 * Build Prisma orderBy object from sort parameters
 * Converts sort field and direction to Prisma format
 * @param {string} sortBy - Field to sort by (a key of sortFields, or its `.value`)
 * @param {string} sortDir - Sort direction ('asc' or 'desc')
 * @param {Object} sortFields - Object mapping field names to their database names
 * @returns {Object} Prisma orderBy object or null if no sorting
 */
module.exports.buildOrderByClause = ({sortBy, sortDir, sortFields}) => {
  if (!sortBy) return null;

  // Callers validate sortBy against *_SORT_FIELDS_VALUES (the `.value` of each
  // entry, e.g. 'user.firstName') but the map is keyed by the short name
  // ('firstName'), so a key-only lookup silently dropped every accepted sort.
  // Accept either form. Own keys only: `sortBy=toString` would otherwise resolve
  // Object.prototype.toString and throw on `.searchValue` below.
  const field =
    (Object.hasOwn(sortFields, sortBy) && sortFields[sortBy]) ||
    Object.values(sortFields).find((entry) => entry.value === sortBy);

  if (!field) return null;

  const {SORT_ORDERS} = require('../constants/generalConstant');
  const direction = sortDir === SORT_ORDERS.desc.value ? 'desc' : 'asc';

  const searchValue = field.searchValue;

  // Handle nested paths (e.g., 'user.firstName' -> {user: {firstName: 'asc'}})
  if (searchValue.includes('.')) {
    const parts = searchValue.split('.');
    const orderBy = {};
    let current = orderBy;

    for (let i = 0; i < parts.length - 1; i++) {
      current[parts[i]] = {};
      current = current[parts[i]];
    }

    current[parts[parts.length - 1]] = direction;

    return orderBy;
  }

  // Simple field (no nesting)
  return {
    [searchValue]: direction,
  };
};

/**
 * Recursively mask sensitive fields in a data object
 * Replaces values of specified field names with '[REDACTED]'
 *
 * @param {Object} params
 * @param {Object|Array} params.data - The data to mask
 * @param {string[]} params.fieldsToMask - Field names to redact
 * @returns {Object|Array} A shallow copy with sensitive fields masked
 */
module.exports.maskSensitiveFields = ({data, fieldsToMask = []}) => {
  if (!data || typeof data !== 'object') return data;

  // eslint-disable-next-line local-rules/no-spread-operator
  const masked = Array.isArray(data) ? [...data] : {...data};

  for (const key of Object.keys(masked)) {
    if (fieldsToMask.includes(key)) {
      masked[key] = '[REDACTED]';
    } else if (typeof masked[key] === 'object' && masked[key] !== null) {
      masked[key] = module.exports.maskSensitiveFields({
        data: masked[key],
        fieldsToMask,
      });
    }
  }

  return masked;
};

/**
 * Build an object containing only keys whose values are not undefined.
 * Replaces the manual `if (x !== undefined) obj.x = x` pattern
 * and the `Object.keys(data).forEach(k => { if (data[k] === undefined) delete data[k] })` pattern.
 *
 * @param {Object} obj - Source object to filter
 * @returns {Object} A new object with only defined values
 */
module.exports.filterUndefined = ({obj}) => {
  const result = {};
  for (const key of Object.keys(obj)) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }

  return result;
};

/**
 * Build a Prisma `AND` clause that performs a case-insensitive name search
 * across one or more string fields. Each whitespace-separated token in the
 * search input must match at least one of the listed fields, allowing inputs
 * like "john sm" to find "John Smith".
 *
 * Field paths support dot-notation for nested relations (e.g. `user.firstName`).
 *
 * @param {Object} params
 * @param {string} params.name - Raw search input
 * @param {string[]} [params.fields] - Field paths to search
 * @returns {{AND: Array}|null}
 */
module.exports.buildNameSearchClause = ({
  name,
  fields = ['firstName', 'lastName'],
}) => {
  if (!name || typeof name !== 'string') return null;

  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const buildFieldClause = ({path, token}) => {
    const parts = path.split('.');
    let clause = {contains: token, mode: 'insensitive'};
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      clause = {[parts[i]]: clause};
    }

    return clause;
  };

  return {
    AND: tokens.map((token) => ({
      OR: fields.map((path) => buildFieldClause({path, token})),
    })),
  };
};

/**
 * Parses a string value from query parameters into a boolean
 * Specifically handles 'true'/'false' strings
 *
 * @param {string|boolean|undefined} val
 * @returns {boolean|undefined}
 */
module.exports.parseBoolean = ({val}) => {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'boolean') return val;

  return String(val).toLowerCase() === 'true';
};

/**
 * Parses a numeric filter value coming from query parameters.
 * Returns the parsed number, or null when the value is absent, empty, or not a
 * number so the caller can skip applying it. Uses explicit checks (not
 * truthiness) so 0 is treated as a valid filter value.
 *
 * @param {string|number|undefined|null} val
 * @returns {number|null}
 */
module.exports.parseNumericFilter = ({val}) => {
  if (val === undefined || val === null || val === '') return null;

  const parsed = Number(val);

  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * Computes total / count rounded to the given number of decimals, returning 0
 * when count is 0 (or missing) so stats endpoints never divide by zero.
 * Shared by dashboard stats — e.g. average alerts per nurse.
 * Shared by dashboard stats — e.g. average cases per case manager.
 */
module.exports.calculateAverage = ({total, count, decimals = 2}) => {
  if (!count) return 0;

  const factor = 10 ** decimals;

  return Math.round((total / count) * factor) / factor;
};

module.exports.getFrontendBaseUrl = () => {
  if (!config.has('frontendURL')) return '';

  return String(config.get('frontendURL')).replace(/\/+$/, '');
};

// Constant-time string comparison so callers (e.g. credential checks) don't leak
// information through response-timing. Both inputs are SHA-256 hashed first so
// the comparison always runs over fixed-length (32-byte) digests — this avoids a
// length-based early return, which would otherwise leak whether the supplied
// secret matches the configured length. timingSafeEqual then guards the digest
// comparison itself against content-based timing side-channels.
module.exports.safeEqual = ({actual, expected}) => {
  const actualDigest = crypto
    .createHash('sha256')
    .update(String(actual))
    .digest();

  const expectedDigest = crypto
    .createHash('sha256')
    .update(String(expected))
    .digest();

  return crypto.timingSafeEqual(actualDigest, expectedDigest);
};

module.exports.chunkArray = ({items = [], size}) => {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};
