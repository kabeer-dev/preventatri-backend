/**
 * Request Logger Middleware (Global)
 *
 * Automatically logs every incoming HTTP request to the AuditLog table.
 * No per-controller setup required — register once in app.js and it handles everything.
 *
 * HOW IT WORKS:
 * 1. BEFORE controller: fetches the record from DB → stores on req.extra.audit.before
 * 2. Controller runs → mutates the record in DB
 * 3. AFTER response: fetches the same record AGAIN from DB (fresh "after" state)
 * 4. Writes both before + after to AuditLog
 *
 * All URL parsing, action resolution, snapshot helpers, redaction,
 * and context building live in utils/requestLoggerUtils.js
 *
 * EXCLUDED ROUTES:
 * Health checks, docs, and keep-alive endpoints are skipped (see EXCLUDED_ROUTES).
 */

const logger = require('./loggerMiddleware');

const {AUDIT_OPERATIONS} = require('../constants/auditConstants');
const AuditServices = require('../services/auditServices');

const {
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
  extractCreatedResourceId,
  extractUserContext,
  buildAuditContext,
  shouldSkipAuditLog,
  isDuplicateReadAudit,
  isTokenIdPath,
  extractTokenUserId,
  extractTokenOrganizationId,
} = require('../utils/requestLoggerUtils');

/**
 * Global request logger middleware
 * Place this AFTER body parsing, req.extra initialization, and DDoS protection in app.js
 *
 * Flow:
 * 1. Parse URL → resolve resource, ID, action from AUDIT_ROUTE_CONFIG
 * 2. For UPDATE/DELETE → fetch "before" from DB → store on req.extra.audit.before
 * 3. Call next() → controller runs → response sent
 * 4. On res 'finish' → for CREATE/UPDATE → fetch "after" from DB (fresh read)
 * 5. Write AuditLog entry with both before + after snapshots from actual DB
 */
const requestLoggerMiddleware = async (req, res, next) => {
  try {
    const path = req.originalUrl || req.url;

    // Skip requests explicitly flagged as sub-route calls (e.g. a nested
    // dashboard widget fetch) -- these aren't a direct "view this resource"
    // action from the caller's perspective, so they shouldn't be audit-logged.
    if (req.query?.isSubRoute === 'true' || req.query?.isSubRoute === true)
      return next();

    // Skip excluded routes immediately
    if (isExcludedRoute({path})) return next();

    const resourceSegment = extractResourceSegment({path});
    const routeConfig = resolveRouteConfig({resourceSegment});

    // Skip unrecognized routes (e.g. /api/v1/users/123/data)
    if (!isRecognizedRoute({path, resourceSegment, routeConfig})) return next();

    let resourceId = extractResourceId({path});
    const action = resolveAction({method: req.method, path, routeConfig});

    // Skip "get all" requests (READ with no resource ID) — only log get-by-id.
    // Routes flagged logWithoutId (e.g. /escalations/assigned) are exempt: they
    // return a single scoped record without a UUID in the URL.
    if (
      action === AUDIT_OPERATIONS.READ.value &&
      !resourceId &&
      !routeConfig?.logWithoutId
    )
      return next();

    // For token-ID routes (e.g. /users/profile, /users/language),
    // decode the JWT to get the user ID as the resource ID.
    if (!resourceId && isTokenIdPath({path})) {
      resourceId = extractTokenUserId({req}) || null;
    }

    // Organization-settings routes (resourceIsOrganization, e.g.
    // /organizations/working-hours) update the caller's own organization:
    // decode the JWT to get the organization ID as the resource ID.
    if (!resourceId && routeConfig?.resourceIsOrganization) {
      resourceId = extractTokenOrganizationId({req});
    }

    // ── Initialize audit context on req.extra ──
    req.extra.audit = {
      before: null,
      model: routeConfig?.model || null,
      resourceId: resourceId || null,
      resource: routeConfig?.resource || resourceSegment || null,
      action,
      createdId: null,

      // Controllers may set this when the response body does not carry the
      // newly-created resource ID (e.g. invite flows).
      // The middleware uses it as a fallback to fetch the "after" snapshot.
      // Usage: req.extra.audit.createdId = newRecord.id;

      // Controllers may add fields the record row does not hold (e.g. a
      // resolution's actions and notes); merged into the "after" snapshot.
      afterDetails: null,
    };

    // ── BEFORE CONTROLLER: Fetch current state from DB for UPDATE/DELETE ──
    if (shouldTrackBefore({action}) && resourceId && routeConfig?.model) {
      req.extra.audit.before = await safeFetchRecord({
        model: routeConfig.model,
        id: resourceId,
      });
    }

    // Versioned routes with no UUID in the URL (latestRecordLookup): the
    // "before" is the latest version for the path value, e.g. the current RED
    // escalation policy before PUT /escalation-policies/RED saves a new one.
    if (
      shouldTrackBefore({action}) &&
      !resourceId &&
      routeConfig?.latestRecordLookup
    ) {
      req.extra.audit.before = await safeFetchLatestRecord({
        model: routeConfig.model,
        path,
        organizationId: extractTokenOrganizationId({req}),
        lookup: routeConfig.latestRecordLookup,
      });
    }

    // ── Hook into response finish event (fires after response is sent) ──
    res.on('finish', async () => {
      try {
        const statusCode = res.statusCode;

        // Skip audit log for non-security, non-data-integrity failures (400, 409, 500, etc.)
        if (shouldSkipAuditLog({statusCode})) return;

        // Skip OTP-initiation responses — the real action hasn't happened yet.
        // The audit log will be written on the subsequent request after OTP verification.
        if (req.extra?.flags?.isOtpResponse) return;

        const isSuccess = statusCode >= 200 && statusCode < 300;
        const {userId, organizationId} = extractUserContext({req});
        const audit = req.extra.audit;

        // The organization ID above came from the unverified token (this runs
        // ahead of authMiddleware) — log against the organization
        // authMiddleware verified, and drop a "before" read for any other.
        if (
          routeConfig?.resourceIsOrganization &&
          audit.resourceId !== organizationId
        ) {
          audit.before = null;
          audit.resourceId = organizationId;
        }

        // ── AFTER CONTROLLER: Fetch fresh state from DB ──
        let afterState = null;

        if (isSuccess && shouldTrackAfter({action}) && audit.model) {
          // For CREATE: try to extract the new ID from the controller's response body
          // For UPDATE: use the same ID from the URL
          const isCreateAction = action === AUDIT_OPERATIONS.CREATE.value;
          const isInviteAction = action === AUDIT_OPERATIONS.INVITE.value;

          const isNewResource = isCreateAction || isInviteAction;

          const afterId = isNewResource
            ? (extractCreatedResourceId({
                responseBody: req.extra?.appResponse?.body,
              }) ?? audit.createdId)
            : audit.resourceId;

          // Versioned routes: the "after" is the latest version now saved,
          // and it becomes the logged resource.
          if (!afterId && routeConfig.latestRecordLookup) {
            afterState = await safeFetchLatestRecord({
              model: audit.model,
              path,
              organizationId,
              lookup: routeConfig.latestRecordLookup,
            });

            audit.resourceId = afterState?.id || null;
          }

          if (afterId) {
            afterState = await safeFetchRecord({
              model: audit.model,
              id: afterId,
            });

            // For CREATE/INVITE, capture the newly generated resource ID
            if ((isCreateAction || isInviteAction) && afterId) {
              audit.resourceId = afterId;
            }
          }
        }

        if (afterState && audit.afterDetails) {
          afterState = Object.assign({}, afterState, audit.afterDetails);
        }

        // For failed requests, don't include "before" (no change actually happened)
        let finalBefore = isSuccess ? audit.before : null;

        // A latestRecordLookup "before" was read with the unverified token
        // (this runs ahead of authMiddleware) — keep it only if it belongs to
        // the organization authMiddleware verified, so a forged token can't
        // pull another organization's record into this audit log.
        if (
          routeConfig?.latestRecordLookup &&
          finalBefore?.organizationId !== organizationId
        ) {
          finalBefore = null;
        }

        // Same user reading the same URL again within the dedupe window is
        // logged once. Failed reads (401/403/404) are always logged. A 304
        // (browser revalidation of an unchanged read) counts as a repeat too.
        if (
          statusCode < 400 &&
          action === AUDIT_OPERATIONS.READ.value &&
          (await isDuplicateReadAudit({
            userId,
            organizationId,
            resource: audit.resource,
            resourceId: audit.resourceId,
            url: path,
          }))
        )
          return;

        const keyArraysByField = routeConfig?.keyArraysByField;

        // Build context for failed requests and special actions (login attempts, etc.)
        const context = buildAuditContext({req, action, statusCode});

        // Build audit log entry via AuditServices (fire-and-forget)
        AuditServices.logAudit({
          action,
          resourceName: audit.resource,
          resourceId: audit.resourceId || null,
          userId,
          organizationId,
          before: formatAuditSnapshot({doc: finalBefore, keyArraysByField}),
          after: formatAuditSnapshot({doc: afterState, keyArraysByField}),
          context,
        });
      } catch (err) {
        logger.error('Audit log finish handler error:');
      }
    });

    next();
  } catch (err) {
    // Audit logging should NEVER block or break the main request flow
    logger.error('Request logger middleware error:');
    next();
  }
};

module.exports = requestLoggerMiddleware;
