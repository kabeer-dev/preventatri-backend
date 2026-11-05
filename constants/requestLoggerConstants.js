/**
 * Request Logger Constants
 *
 * Centralized configuration for the global audit logging middleware.
 * Maps every route to its Prisma model so the middleware can automatically
 * capture before/after snapshots and log to the AuditLog table.
 *
 * HOW IT WORKS:
 * - The middleware extracts the resource segment from the URL (e.g., /api/v1/nurses/123 → "nurses")
 * - AUDIT_ROUTE_CONFIG maps that segment to a resource name + Prisma model
 * - HTTP_METHOD_TO_AUDIT_ACTION maps the HTTP method to an AuditAction enum value
 * - For UPDATE/DELETE: the middleware fetches the "before" state from DB before the controller runs
 * - For CREATE/UPDATE: the "after" state is captured from the controller's response
 * - Routes in EXCLUDED_ROUTES are skipped entirely (health checks, docs, etc.)
 *
 * ADDING A NEW RESOURCE:
 * 1. Add the route prefix key (lowercase, as it appears in the URL) to AUDIT_ROUTE_CONFIG
 * 2. Set `resourceType` (stable camelCase key used by the read endpoint's
 *    ?resourceType= filter — decoupled from the display label so renaming the
 *    label never changes the public API)
 * 3. Set `resource` (human-readable name for AuditLog.resourceName)
 * 4. Set `model` (Prisma model PascalCase name — used to query before/after state)
 * 5. That's it — the middleware handles everything else automatically
 */

const {SYSTEM_ENTITIES} = require('./aclConstants');
const {AUDIT_OPERATIONS} = require('./auditConstants');
const {MODELS} = require('./modelConstants');
const {SYSTEM_ROLES} = require('./usersConstants');

const {LOGIN, LOGOUT, INVITE, RESET_PASSWORD, UPDATE} = AUDIT_OPERATIONS;

// Shared by every escalation route: the read endpoint maps labels back to one
// resourceType, so a second label or type here would re-type existing rows.
const ESCALATION_AUDIT_RESOURCE = {
  resourceType: 'assignedEscalation',
  resource: SYSTEM_ENTITIES.escalation.label,
  model: MODELS.SUBMISSION_FLAG_ESCALATION,
};

/**
 * Maps URL route segments to resource info + Prisma model for audit logging
 *
 * Key   = route segment as it appears in the URL path (after /api/v1/)
 * resourceType = stable camelCase key for the read endpoint's ?resourceType=
 *                filter (explicit, not derived from the label — see below)
 * resource = human-readable name stored in AuditLog.resourceName
 * model    = Prisma model PascalCase name (used for before/after DB queries)
 *
 * Uses SYSTEM_ENTITIES labels for consistency with the ACL system.
 *
 * `resourceType` is declared explicitly on every entry instead of being
 * generated from `resource`. Deriving the key from the display label couples
 * the public API contract to the label text — renaming the label (as happened
 * with "Red Flag" → "Emergency Flag") would silently change the accepted query
 * value and break callers. Keeping it separate makes the contract stable.
 */
const AUDIT_ROUTE_CONFIG = {
  users: {
    resourceType: 'user',
    resource: SYSTEM_ENTITIES.users.label,
    model: MODELS.USER,

    logWithoutId: true,
  },
  nurses: {
    resourceType: 'nurse',
    resource: SYSTEM_ENTITIES.nurse.label,
    model: MODELS.NURSE_PROFILE,
  },
  caregivers: {
    resourceType: 'caregiver',
    resource: SYSTEM_ENTITIES.caregiver.label,
    model: MODELS.CAREGIVER_PROFILE,
  },
  patients: {
    resourceType: 'patient',
    resource: SYSTEM_ENTITIES.patient.label,
    model: MODELS.PATIENT,

    logWithoutId: true,
  },
  'case-managers': {
    resourceType: 'caseManager',
    resource: SYSTEM_ENTITIES.caseManager.label,
    model: MODELS.CASE_MANAGER_PROFILE,
  },
  'assessments/assignments': {
    resourceType: 'checklistAssignment',
    resource: SYSTEM_ENTITIES.checklistAssignment.label,
    model: MODELS.CHECKLIST_ASSIGNMENT,
  },
  'assessments/emergency-flags': {
    resourceType: 'emergencyFlag',
    resource: SYSTEM_ENTITIES.emergencyFlag.label,
    model: MODELS.SUBMISSION_FLAG,

    logWithoutId: true,
  },

  'assessments/escalations/assigned': ESCALATION_AUDIT_RESOURCE,

  // POST /escalations/:id/resolve flips the escalation to RESOLVED, so it is
  // logged as an UPDATE of that escalation rather than a CREATE.
  'assessments/escalations': Object.assign({}, ESCALATION_AUDIT_RESOURCE, {
    actionBySuffix: {resolve: UPDATE.value},
  }),

  // ── Patient sub-resources ──
  'patients/assessments': {
    resourceType: 'patientAssessments',
    resource: 'Patient Assessments',
    model: MODELS.CHECKLIST_SUBMISSION,
  },

  // ── Caregiver sub-resources ──
  'caregivers/statistics': {
    resourceType: 'caregiverStatistics',
    resource: 'Caregiver Statistics',
    model: MODELS.CAREGIVER_PROFILE,
  },
  'triage-engine/alerts': {
    resourceType: 'triageAlert',
    resource: 'Alert',
    model: MODELS.SUBMISSION_FLAG,

    logWithoutId: true,
  },
  'follow-up-tasks': {
    resourceType: 'followUpTask',
    resource: SYSTEM_ENTITIES.followUpTask.label,
    model: MODELS.FOLLOW_UP_TASK,

    logWithoutId: true,
  },
  'supervisory-visits': {
    resourceType: 'supervisoryVisit',
    resource: SYSTEM_ENTITIES.supervisoryVisit.label,
    model: MODELS.SUPERVISORY_VISIT,

    logWithoutId: true,
  },
  'integration/visits': {
    resourceType: 'hhaVisit',
    resource: 'HHA Visit',
    model: MODELS.HHA_VISIT,

    logWithoutId: true,
  },
  'assessments/templates': {
    resourceType: 'checklistTemplate',
    resource: SYSTEM_ENTITIES.checklistTemplate.label,
    model: MODELS.CHECKLIST_TEMPLATE,

    logWithoutId: true,
  },
  'assessments/submissions': {
    resourceType: 'checklistSubmission',
    resource: SYSTEM_ENTITIES.checklistSubmission.label,
    model: MODELS.CHECKLIST_SUBMISSION,

    logWithoutId: true,
  },
  regions: {
    resourceType: 'region',
    resource: SYSTEM_ENTITIES.region.label,
    model: MODELS.REGION,

    logWithoutId: true,
  },
  'audit-logs': {
    resourceType: 'auditLog',
    resource: SYSTEM_ENTITIES.auditLog.label,
    model: MODELS.AUDIT_LOG,

    logWithoutId: true,
  },
  'securities/otp-methods': {
    resourceType: 'otpMethod',
    resource: SYSTEM_ENTITIES.otpMethod.label,
    model: MODELS.SECURITY,
  },
  'sessions/signout': {
    resourceType: 'SignoutADevice',
    resource: SYSTEM_ENTITIES.signoutADevice.label,
    model: MODELS.USER_SESSION,
  },

  'organizations/escalation-policies': {
    resourceType: 'escalationPolicy',
    resource: 'Escalation Policy',
    model: MODELS.ESCALATION_POLICY,

    // PUT /escalation-policies/:flag has no record id in the URL and saves a
    // new version row instead of updating one, so before/after are the
    // organization's latest version for that flag, read before and after.
    latestRecordLookup: {pathParam: 'flag', versionField: 'version'},

    // Steps are an id-less array: keyed by step type in the snapshots so the
    // audit diff shows each step's changed fields (order, TTL, channels).
    keyArraysByField: {steps: 'type'},
  },
  'organizations/working-hours': {
    resourceType: 'workingHours',
    resource: 'Working Hours',
    model: MODELS.ORGANIZATION,
    resourceIsOrganization: true,
  },
  'organizations/time-zone': {
    resourceType: 'timeZone',
    resource: 'Time Zone',
    model: MODELS.ORGANIZATION,
    resourceIsOrganization: true,
  },

  // Logged against the organization: the credentials row has no id in the URL,
  // and its secret and key must never reach a snapshot.
  'organizations/hha-credentials': {
    resourceType: 'hhaCredentials',
    resource: 'HHAeXchange Credentials',
    model: MODELS.ORGANIZATION,
    resourceIsOrganization: true,
  },
  'sessions/signout-other-devices': {
    resourceType: 'SignoutAllOtherDevices',
    resource: SYSTEM_ENTITIES.signoutAllOtherDevices.label,
    model: MODELS.USER_SESSION,
  },
};

/**
 * Optional per-route keys on AUDIT_ROUTE_CONFIG entries:
 *
 * latestRecordLookup = {pathParam, versionField} for versioned resources
 *                      addressed by a path value instead of a UUID. The
 *                      snapshot is the organization's row whose `pathParam`
 *                      equals the last URL segment, with the highest
 *                      `versionField`.
 * resourceIsOrganization = true when the route updates the caller's own
 *                      organization (no ID in the URL): the organization ID
 *                      from the token is the resource ID.
 * keyArraysByField   = {field: itemKey} turns an id-less array field into an
 *                      object keyed by each item's `itemKey` (plus its 1-based
 *                      `order`), so the audit diff can compare items field by
 *                      field instead of reporting "Added: item; Removed: item".
 * actionBySuffix     = {suffix: AuditAction} overrides the HTTP-method action
 *                      when the URL's last segment is `suffix`.
 */

/**
 * Read-endpoint (GET /audit-logs) resourceType key → stored
 * AuditLog.resourceName label.
 *
 * Built from each entry's explicit `resourceType` key, so AUDIT_ROUTE_CONFIG
 * stays the single source of truth for every entity type the audit writer
 * emits — new audited routes are covered automatically. The read endpoint
 * accepts one of these keys and translates it back to the stored label to
 * filter by entity type.
 */
const AUDIT_RESOURCE_TYPES = Object.values(AUDIT_ROUTE_CONFIG).reduce(
  (types, {resourceType, resource}) =>
    Object.assign(types, {[resourceType]: resource}),
  {
    // Legacy label retained from before "Red Flag" was renamed to
    // "Emergency Flag"; kept so historical audit rows remain queryable.
    redFlag: 'Red Flag',
  }
);

const AUDIT_RESOURCE_TYPE_VALUES = Object.keys(AUDIT_RESOURCE_TYPES);

/**
 * Special sub-path overrides for audit action.
 * When a URL contains one of these segments, the action is overridden
 * instead of using the default HTTP method → AuditAction mapping.
 *
 * Key   = URL sub-path segment (matched with path.includes)
 * Value = AuditAction enum value (must match Prisma enum)
 *
 * ⚠️  ORDER MATTERS — more-specific paths must appear before generic ones:
 *   /verify/refresh  → before /verify/
 *   /verify/new/     → before /verify/
 *   /reset/          → before any bare /reset
 */
const SPECIAL_ACTION_ROUTES = {
  // ── Auth flow ──────────────────────────────────────────
  '/login': LOGIN.value,
  '/logout': LOGOUT.value,
  '/invite': INVITE.value,
  '/reset/': RESET_PASSWORD.value, // /reset/:token
};

// /api/v1/integration is absent here on purpose. The sync is queued, so this
// middleware's res.on('finish') hook fires when the 202 is sent and would
// record a run that has not happened. hhaExchangeController and
// hhaSyncReportingServices write those rows explicitly instead.

/**
 * Route patterns to exclude from audit logging
 * Matched against the full request path (case-insensitive prefix match)
 */
const EXCLUDED_ROUTES = [
  '/api/v1/docs', // Swagger documentation
  '/api/v1/health', // Health check endpoints
  '/api/v1/awake', // Keep-alive endpoint
  '/api/v1/users/me',
  '/favicon.ico', // Browser automatic requests
];

/**
 * Routes where the resource ID comes from the JWT token (user ID)
 * instead of the URL path. Matched against the path suffix after /api/v1/users.
 */
const TOKEN_ID_ROUTES = ['/users/profile', '/users/language'];

/**
 * Known trailing path suffixes scoped per resource.
 * Prevents false-positive route recognition for paths like /api/v1/users/:id/assessments.
 * Only the listed suffix is valid for that specific resource.
 */
const RECOGNIZED_PATH_SUFFIXES_BY_RESOURCE = {
  patients: ['assessments'],
  caregivers: ['statistics'],
  assessments: ['skip', 'void', 'resolve'],
  'supervisory-visits': [
    'complete',
    'cancel',
    'reopen',
    'approve',
    'request-correction',
    'assignees',
  ],
  'follow-up-tasks': ['submit', 'complete', 'cancel', 'reopen', 'assignees'],

  // The :flag of /organizations/escalation-policies/:flag.
  organizations: ['red', 'yellow'],

  // Suffixes trailing the 'users/admin/stats' three-segment key, e.g.
  // /users/admin/stats/timeseries and /users/admin/stats/sla.
  users: ['timeseries', 'sla'],
};

/**
 * Request body fields to redact before storing in audit context
 * These fields will be replaced with '[REDACTED]'
 */
const REDACTED_BODY_FIELDS = [
  // HHAeXchange credentials, sent in the body of PUT /organizations/hha-credentials.
  // They must never be loggable: do not remove these two.
  'appSecret',
  'appKey',
  'password',
  'confirmPassword',
  'token',
  'otp',
  'secretKey',
  'refreshToken',
  'accessToken',
  'newPassword',
  'currentPassword',
];

/**
 * Maximum length for stored request body context (in characters)
 * Prevents oversized payloads from bloating the audit_logs table
 */

/**
 * Categorize HTTP failure status codes into meaningful failure types.
 * Used by the audit logger to tag failed requests for easier filtering/reporting.
 *
 * Only codes listed here are logged — any failure NOT in this map is skipped.
 *
 * AUTHENTICATION (401) — invalid/expired token, wrong credentials
 * AUTHORIZATION  (403) — valid user but lacks permission for the action
 * NOT_FOUND      (404) — requested resource does not exist
 */
const FAILURE_CATEGORIES = {
  401: 'AUTHENTICATION',
  403: 'AUTHORIZATION',
  404: 'NOT_FOUND',
};

/**
 * A successful READ repeated by the same user on the same URL within this
 * window is audit-logged once. The Redis check gives up after the timeout so
 * a slow or down Redis never delays the audit write (the log is written).
 */
const READ_AUDIT_DEDUPE_WINDOW_SECONDS = 60;
const READ_AUDIT_DEDUPE_TIMEOUT_MS = 200;

/**
 * Resolve a human-readable failure category from an HTTP status code
 * @param {number} statusCode
 * @returns {string}
 */
const resolveFailureCategory = ({statusCode}) => {
  return FAILURE_CATEGORIES[statusCode] || 'UNKNOWN';
};

/**
 * Audit config for each user type invitable through POST /users/invite. The
 * middleware derives the config from the URL segment, which is always "users"
 * there, so the invite dispatcher swaps in the invited profile's config —
 * otherwise a NurseProfile id would be logged against the User model.
 */
const INVITE_AUDIT_CONFIG_BY_USER_TYPE = {
  [SYSTEM_ROLES.nurse.value]: AUDIT_ROUTE_CONFIG.nurses,
  [SYSTEM_ROLES.caregiver.value]: AUDIT_ROUTE_CONFIG.caregivers,
  [SYSTEM_ROLES.case_manager.value]: AUDIT_ROUTE_CONFIG['case-managers'],
};

module.exports = {
  AUDIT_ROUTE_CONFIG,
  INVITE_AUDIT_CONFIG_BY_USER_TYPE,
  AUDIT_RESOURCE_TYPES,
  AUDIT_RESOURCE_TYPE_VALUES,
  SPECIAL_ACTION_ROUTES,
  EXCLUDED_ROUTES,
  REDACTED_BODY_FIELDS,
  FAILURE_CATEGORIES,
  TOKEN_ID_ROUTES,
  RECOGNIZED_PATH_SUFFIXES_BY_RESOURCE,
  READ_AUDIT_DEDUPE_WINDOW_SECONDS,
  READ_AUDIT_DEDUPE_TIMEOUT_MS,
  resolveFailureCategory,
};
