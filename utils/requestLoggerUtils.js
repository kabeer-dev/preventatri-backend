/**
 * Request Logger Utilities
 *
 * Helper functions for the global request audit logging middleware.
 * Handles URL parsing, action resolution, DB snapshot fetching,
 * sensitive-field redaction, and audit context building.
 */

const crypto = require('crypto');

const {sleep} = require('./general');
const {getTokenHeaderName} = require('./getTokenHeaderUtils');

const {decodeToken, getToken} = require('./jwtUtils');

const {
  HTTP_METHOD_TO_AUDIT_ACTION,
  AUDIT_OPERATIONS,
} = require('../constants/auditConstants');

const {SORT_ORDERS} = require('../constants/generalConstant');

const {
  AUDIT_ROUTE_CONFIG,
  SPECIAL_ACTION_ROUTES,
  EXCLUDED_ROUTES,
  REDACTED_BODY_FIELDS,
  FAILURE_CATEGORIES,
  TOKEN_ID_ROUTES,
  RECOGNIZED_PATH_SUFFIXES_BY_RESOURCE,
  READ_AUDIT_DEDUPE_WINDOW_SECONDS,
  READ_AUDIT_DEDUPE_TIMEOUT_MS,
  resolveFailureCategory,
} = require('../constants/requestLoggerConstants');

const {PrismaFactory} = require('../factories');
const {redisConnection} = require('../lib/redis');
const logger = require('../middleware/loggerMiddleware');

// UUID pattern (any version) for extracting resource IDs from URL paths
const UUID_REGEX =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const UUID_ONLY_REGEX = new RegExp(`^${UUID_REGEX.source}$`, 'i');

const {CREATE, READ, UPDATE, DELETE, LOGIN, INVITE} = AUDIT_OPERATIONS;

// ──────────────────────────────────────────────
// URL PARSING HELPERS
// ──────────────────────────────────────────────

/**
 * Extract the resource segment from a URL path
 * Supports both single-segment and two-segment (nested) resource keys.
 * e.g., /api/v1/nurses/abc-123            → "nurses"
 *       /api/v1/case-managers             → "case-managers"
 *       /api/v1/assessments/templates/123 → "assessments/templates"
 *       /awake                            → null
 */
const extractResourceSegment = ({path}) => {
  // Try three-segment match first (e.g. assessments/escalations/assigned).
  // Only returned when the full key exists in the config; otherwise we fall
  // through so /assessments/escalations/:uuid still resolves to a shorter key.
  const threeSegMatch = path.match(/^\/api\/v\d+\/([^/?]+\/[^/?]+\/[^/?]+)/);

  if (threeSegMatch) {
    const threeSegKey = threeSegMatch[1].toLowerCase();

    if (AUDIT_ROUTE_CONFIG[threeSegKey]) return threeSegKey;
  }

  // Try two-segment match next (e.g. assessments/templates)
  const twoSegMatch = path.match(/^\/api\/v\d+\/([^/?]+\/[^/?]+)/);

  if (twoSegMatch) {
    const twoSegKey = twoSegMatch[1].toLowerCase();

    if (AUDIT_ROUTE_CONFIG[twoSegKey]) return twoSegKey;
  }

  // Try resource/suffix pattern for sub-resource paths (e.g. patients/:id/assessments)
  const subResourceMatch = path.match(
    /^\/api\/v\d+\/([^/?]+)\/[0-9a-f-]+\/([^/?]+)/i
  );

  if (subResourceMatch) {
    const subResourceKey = `${subResourceMatch[1].toLowerCase()}/${subResourceMatch[2].toLowerCase()}`;

    if (AUDIT_ROUTE_CONFIG[subResourceKey]) return subResourceKey;
  }

  // Fall back to single-segment match
  const match = path.match(/^\/api\/v\d+\/([^/?]+)/);

  return match ? match[1].toLowerCase() : null;
};

/**
 * Extract a UUID resource ID from the URL path segments
 * e.g., /api/v1/nurses/550e8400-e29b-41d4-a716-446655440000 → "550e8400-..."
 *       /api/v1/nurses → null
 */
const extractResourceId = ({path}) => {
  // Query strings never hold the resource id: /assignees?patientId=<uuid>
  const segments = path.split('?')[0].split('/').filter(Boolean);

  // Look for a UUID segment (typically the segment after the resource name)
  for (const segment of segments) {
    if (UUID_ONLY_REGEX.test(segment)) return segment;
  }

  return null;
};

// ──────────────────────────────────────────────
// ACTION RESOLUTION
// ──────────────────────────────────────────────

/**
 * Resolve AuditAction from HTTP method + URL path
 * Special sub-paths (login, logout, etc.) and the route's actionBySuffix
 * override the default HTTP→action mapping
 */
const resolveAction = ({method, path, routeConfig}) => {
  const lowerPath = path.toLowerCase();

  const lastSegment = lowerPath.split('?')[0].split('/').filter(Boolean).pop();
  const suffixAction = routeConfig?.actionBySuffix?.[lastSegment];

  if (suffixAction) return suffixAction;

  // Check for special path-based action overrides (LOGIN, LOGOUT, etc.)
  for (const [segment, action] of Object.entries(SPECIAL_ACTION_ROUTES)) {
    if (lowerPath.includes(segment)) return action;
  }

  // Fall back to standard HTTP method → AuditAction mapping
  return HTTP_METHOD_TO_AUDIT_ACTION[method] || READ.value;
};

/**
 * Check if a route should be excluded from audit logging
 */
const isExcludedRoute = ({path}) => {
  return EXCLUDED_ROUTES.some((excluded) =>
    path.toLowerCase().startsWith(excluded.toLowerCase())
  );
};

/**
 * Check if a path is a recognized auditable route.
 * Valid patterns: /api/v1/<resource>, /api/v1/<resource>/<uuid>,
 * /api/v1/<resource>/<special-action>, /api/v1/<resource>/<uuid>/<special-action>
 *
 * Rejects paths with unrecognized trailing segments (e.g. /api/v1/users/123/data)
 */
const isRecognizedRoute = ({path, resourceSegment, routeConfig}) => {
  // No resource segment or no route config → not a recognized route
  if (!resourceSegment || !routeConfig) return false;

  // Strip query params and split into segments
  const cleanPath = path.split('?')[0];
  const segments = cleanPath.split('/').filter(Boolean);

  // Expected: ['api', 'v1', resourceSegment, ...rest]
  // For two-segment keys (e.g. 'assessments/templates'), find the first part
  const resourceParts = resourceSegment.split('/');

  const resourceIndex = segments.findIndex(
    (s) => s.toLowerCase() === resourceParts[0]
  );

  if (resourceIndex === -1) return false;

  // Get segments after the full resource key (skip all resource parts)
  const trailing = segments.slice(resourceIndex + resourceParts.length);

  // Valid trailing patterns:
  // [] → list/create (GET /users, POST /users)
  // [uuid] → read/update/delete (GET /users/:id)
  // [special] → special action (POST /users/login)
  // [uuid, special] → special action on resource (POST /users/:id/invite)
  for (const segment of trailing) {
    const isUuid = UUID_REGEX.test(segment);

    const isSpecialPath = Object.keys(SPECIAL_ACTION_ROUTES).some(
      (sp) => sp.replace(/\//g, '') === segment.toLowerCase()
    );

    const isTokenIdSuffix = TOKEN_ID_ROUTES.some((tp) => {
      const lastPart = tp.split('/').filter(Boolean).pop();

      return lastPart === segment.toLowerCase();
    });

    const allowedSuffixes =
      RECOGNIZED_PATH_SUFFIXES_BY_RESOURCE[resourceParts[0].toLowerCase()] ||
      [];
    const isRecognizedSuffix = allowedSuffixes.includes(segment.toLowerCase());

    if (!isUuid && !isSpecialPath && !isTokenIdSuffix && !isRecognizedSuffix)
      return false;
  }

  return true;
};

/**
 * Resolve route config from AUDIT_ROUTE_CONFIG for a given resource segment
 */
const resolveRouteConfig = ({resourceSegment}) =>
  resourceSegment ? AUDIT_ROUTE_CONFIG[resourceSegment] : null;

// ──────────────────────────────────────────────
// BEFORE/AFTER SNAPSHOT HELPERS
// ──────────────────────────────────────────────

const USER_CROSS_ORG_FIELDS = ['userOrganizations', 'permissions'];

/**
 * Safely fetch a record from the database by model name and ID
 * Uses PrismaFactory.findOne for consistency with the rest of the codebase
 * Returns null on any error — never blocks the request
 */
const safeFetchRecord = async ({model, id}) => {
  try {
    if (!model || !id) return null;

    const {success, doc} = await PrismaFactory.findOne({
      model,
      query: {id},
    });

    if (!success || !doc) return null;

    // A user's memberships and permissions span every organization they
    // belong to, and the snapshot is stored in the acting organization's log.
    return Object.fromEntries(
      Object.entries(doc).filter(
        ([key]) => !USER_CROSS_ORG_FIELDS.includes(key)
      )
    );
  } catch (err) {
    logger.warn(`Audit DB fetch failed [${model}/${id}]`);

    return null;
  }
};

/**
 * Safely fetch the latest version of a versioned record addressed by a path
 * value instead of a UUID (routes with `latestRecordLookup`, e.g.
 * /organizations/escalation-policies/RED → the organization's highest-version
 * RED policy). Returns null on any error — never blocks the request.
 */
const safeFetchLatestRecord = async ({model, path, organizationId, lookup}) => {
  try {
    const pathValue = path.split('?')[0].split('/').filter(Boolean).pop();

    if (!model || !organizationId || !pathValue) return null;

    const {success, docs} = await PrismaFactory.find({
      model,
      query: {organizationId, [lookup.pathParam]: pathValue},
      options: {
        bypassExtraQueries: true,
        take: 1,
        sort: {[lookup.versionField]: SORT_ORDERS.desc.value},
      },
    });

    return success ? docs?.[0] || null : null;
  } catch (err) {
    logger.warn(`Audit DB fetch failed [${model}/${path}]`);

    return null;
  }
};

/**
 * Reshape a snapshot per the route's `keyArraysByField`: each listed array
 * field becomes an object keyed by the camelCased `itemKey` of its items, each
 * carrying its 1-based `order`. e.g. steps [{type: 'PRIMARY_NURSE', ...}] →
 * steps {primaryNurse: {order: 1, ...}}, which the audit diff renders as
 * "Steps > Primary Nurse > Order: 1 → 2". Returns the snapshot unchanged when
 * the route has no such fields.
 */
const formatAuditSnapshot = ({doc, keyArraysByField}) => {
  if (!doc || !keyArraysByField) return doc;

  const formatted = Object.assign({}, doc);

  for (const [field, itemKey] of Object.entries(keyArraysByField)) {
    if (!Array.isArray(doc[field])) continue;

    formatted[field] = doc[field].reduce((byKey, item, index) => {
      const key = String(item?.[itemKey])
        .toLowerCase()
        .replace(/_([a-z0-9])/g, (match, char) => char.toUpperCase());

      byKey[key] = Object.assign({order: index + 1}, item);
      delete byKey[key][itemKey];

      return byKey;
    }, {});
  }

  return formatted;
};

/**
 * Determine whether this action needs a "before" snapshot (pre-controller DB read)
 * UPDATE and DELETE need the original record before it's changed/removed
 */
const shouldTrackBefore = ({action}) =>
  [UPDATE.value, DELETE.value].includes(action);

/**
 * Determine whether this action needs an "after" snapshot (post-controller DB read)
 * CREATE and UPDATE need the final record after the controller has written to DB
 */
const shouldTrackAfter = ({action}) =>
  [CREATE.value, UPDATE.value, INVITE.value].includes(action);

/**
 * Try to extract the new resource ID from the controller's response body
 * Used for CREATE actions where the ID doesn't exist in the URL
 * Looks for common patterns: body.id, body.<entity>.id, body.<entity>.profileId
 */
const extractCreatedResourceId = ({responseBody}) => {
  if (!responseBody || typeof responseBody !== 'object') return null;

  // Direct id on body (e.g., { id: '...', ...rest })
  if (responseBody.id) return responseBody.id;

  // Look through body keys for nested objects with an id field
  // e.g., { nurse: { profileId: '...' }, type: '...' }
  // e.g., { patient: { id: '...' }, type: '...' }
  for (const value of Object.values(responseBody)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.profileId) return value.profileId;
      if (value.id) return value.id;
    }
  }

  return null;
};

/**
 * Extract user context from JWT token on the request
 */
const extractUserContext = ({req}) => {
  // Primary: decoded JWT token (set by authMiddleware)
  // Fallback: entities.user (set by login/logout controllers when no authMiddleware runs)
  const user = req.extra?.jwtToken?.user || req.extra?.entities?.user || null;

  return {
    userId: user?.id || null,
    organizationId: user?.currentActiveOrganization?.organizationId || null,
  };
};

/**
 * Redact sensitive fields from any value (object/array/primitive)
 * Returns a deep, non-mutating copy with sensitive values replaced by '[REDACTED]'
 */
const redactSensitiveFields = ({data}) => {
  if (!data || typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveFields({data: item}));
  }

  const redacted = {};

  for (const [key, value] of Object.entries(data)) {
    if (REDACTED_BODY_FIELDS.includes(key)) {
      redacted[key] = '[REDACTED]';
      continue;
    }

    if (value && typeof value === 'object') {
      redacted[key] = redactSensitiveFields({data: value});
      continue;
    }

    redacted[key] = value;
  }

  return redacted;
};

/**
 * Build audit context for failed requests and special actions.
 *
 * Failure types tagged via failureCategory:
 * - AUTHENTICATION (401): wrong credentials, expired/invalid token
 * - AUTHORIZATION  (403): valid user but no permission for the action
 * - VALIDATION     (400): bad payload, missing required fields
 * - NOT_FOUND      (404): resource does not exist
 * - CONFLICT       (409): duplicate resource
 * - SERVER_ERROR   (5xx): unexpected internal errors
 *
 * Special action context captured:
 * - LOGIN:          attemptedEmail, loginFailed flag
 * - FORGOT_PASSWORD: attemptedEmail (who initiated the reset)
 * - INVITE_USER:    invitedEmail (who was invited)
 */
const buildAuditContext = ({req, action, statusCode}) => {
  const isFailure = statusCode >= 400;
  const context = {};

  // ── Failure categorization ──
  if (isFailure) {
    context.failureCategory = resolveFailureCategory({statusCode});
    context.statusCode = statusCode;

    const errResponse = req.extra?.errResponse;

    if (errResponse?.message) context.errorMessage = errResponse.message;
    if (errResponse?.error?.type) context.errorType = errResponse.error.type;
  }

  // ── LOGIN-specific context ──
  if (action === LOGIN.value) {
    const email = req.body?.email;

    if (email) context.attemptedEmail = email;
    if (isFailure) context.loginFailed = true;
  }

  // ── INVITE: capture who was invited ──
  if (action === INVITE.value) {
    const email = req.body?.email;

    if (email) context.invitedEmail = email;
  }

  // ── For any failure, include redacted request body for debugging ──
  if (isFailure && req.body && Object.keys(req.body).length > 0) {
    context.requestBody = redactSensitiveFields({data: req.body});
  }

  // ── For permission / auth failures, capture the attempted path + method ──
  if (isFailure && (statusCode === 401 || statusCode === 403)) {
    context.attemptedMethod = req.method;
    context.attemptedPath = req.originalUrl || req.url;
  }

  return Object.keys(context).length > 0 ? context : null;
};

/**
 * Determine whether an audit log should be skipped for this response.
 * Failures not present in FAILURE_CATEGORIES (e.g. 400, 409, 500) are not
 * security/data-integrity events worth recording, so they are skipped.
 */
const shouldSkipAuditLog = ({statusCode}) =>
  statusCode >= 400 && !FAILURE_CATEGORIES[statusCode];

/**
 * Check whether the same user already read the same URL within the dedupe
 * window. The first call sets a Redis key that expires after the window (NX, so
 * repeats never extend it) and returns false; repeats inside the window return
 * true. Fails open: any Redis error or timeout returns false so the log is
 * still written.
 */
const isDuplicateReadAudit = async ({
  userId,
  organizationId,
  resource,
  resourceId,
  url,
}) => {
  if (!userId) return false;

  try {
    const signature = [userId, organizationId, resource, resourceId, url].join(
      '|'
    );

    const key = `audit:read-dedupe:${crypto
      .createHash('sha256')
      .update(signature)
      .digest('hex')}`;

    const timeout = sleep({time: READ_AUDIT_DEDUPE_TIMEOUT_MS}).then(
      () => 'timeout'
    );

    const result = await Promise.race([
      redisConnection.set(
        key,
        '1',
        'EX',
        READ_AUDIT_DEDUPE_WINDOW_SECONDS,
        'NX'
      ),
      timeout,
    ]);

    // SET ... NX returns null when the key already existed
    return result === null;
  } catch (err) {
    logger.warn(`Audit read dedupe check failed: ${err.message}`);

    return false;
  }
};

/**
 * Check if the current path is a token-ID route (resource ID comes from JWT).
 * Matches against TOKEN_ID_ROUTES using a suffix check on the path.
 */
const isTokenIdPath = ({path}) => {
  const lowerPath = path.toLowerCase().split('?')[0];

  return TOKEN_ID_ROUTES.some((tokenPath) => lowerPath.endsWith(tokenPath));
};

/**
 * Decode (without verifying) the JWT from the request cookie or header.
 */
const decodeRequestToken = ({req}) => {
  const cookieToken = getToken({cookieStr: req.headers?.cookie});
  const headerToken = req.headers?.[getTokenHeaderName()];
  const token = cookieToken || headerToken;

  if (!token) return null;

  return decodeToken({token}) || null;
};

/**
 * Extract user ID from the JWT token on the request.
 * Used for token-ID routes where the resource ID is the authenticated user's ID.
 */
const extractTokenUserId = ({req}) =>
  decodeRequestToken({req})?.user?.id || null;

/**
 * Extract the active organization ID from the JWT token on the request.
 * The logger runs before authMiddleware, so req.extra.jwtToken isn't set yet
 * when the "before" snapshot of an organization-scoped lookup is read.
 */
const extractTokenOrganizationId = ({req}) =>
  decodeRequestToken({req})?.user?.currentActiveOrganization?.organizationId ||
  null;

module.exports = {
  extractResourceSegment,
  extractResourceId,
  resolveAction,
  isExcludedRoute,
  isRecognizedRoute,
  resolveRouteConfig,
  safeFetchRecord,
  safeFetchLatestRecord,
  formatAuditSnapshot,
  shouldTrackBefore,
  shouldTrackAfter,
  shouldSkipAuditLog,
  isDuplicateReadAudit,
  extractCreatedResourceId,
  extractUserContext,
  buildAuditContext,
  isTokenIdPath,
  extractTokenUserId,
  extractTokenOrganizationId,
};
