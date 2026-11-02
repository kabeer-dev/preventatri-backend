/**
 * Audit Logging Constants
 */

// Audit operations (matching Prisma enum AuditAction)
const AUDIT_OPERATIONS = {
  CREATE: {value: 'CREATE'},
  READ: {value: 'READ'},
  UPDATE: {value: 'UPDATE'},
  DELETE: {value: 'DELETE'},
  LOGIN: {value: 'LOGIN'},
  LOGOUT: {value: 'LOGOUT'},
  RESET_PASSWORD: {value: 'RESET_PASSWORD'},
  INVITE: {value: 'INVITE'},
  ACCOUNT_LOCK: {value: 'ACCOUNT_LOCK'},
  ACCOUNT_UNLOCK: {value: 'ACCOUNT_UNLOCK'},

  // Three actions rather than one SYNC plus a status field, so the audit UI can
  // filter on action directly (AuditLog is indexed on it).
  SYNC_STARTED: {value: 'SYNC_STARTED'},
  SYNC_COMPLETED: {value: 'SYNC_COMPLETED'},
  SYNC_FAILED: {value: 'SYNC_FAILED'},

  INVITE_RESENT: {value: 'INVITE_RESENT'},
  INVITE_ACCEPTED: {value: 'INVITE_ACCEPTED'},
  INVITE_REVOKED: {value: 'INVITE_REVOKED'},

  // The file is generated in the browser, so the client reports the download.
  DATA_EXPORTED: {value: 'DATA_EXPORTED'},

  // Written by the escalation workers, not by an HTTP request.
  ESCALATION_STARTED: {value: 'ESCALATION_STARTED'},
  ESCALATION_ASSIGNED: {value: 'ESCALATION_ASSIGNED'},
  ESCALATED: {value: 'ESCALATED'},

  // Written by the accept request; the actor is the assignee who accepted.
  ESCALATION_ACCEPTED: {value: 'ESCALATION_ACCEPTED'},

  // Written by the notification delivery worker, on the alert's escalation.
  NOTIFICATION_DELIVERY: {value: 'NOTIFICATION_DELIVERY'},
};

const AUDIT_OPERATIONS_VALUES = Object.values(AUDIT_OPERATIONS).map(
  (op) => op.value
);

// Audit resource names (matching Prisma model names)
const AUDIT_RESOURCES = {
  NURSE: {value: 'Nurse'},

  // Not a Prisma model: a run has no table, so its uuid is the resourceId.
  HHA_SYNC: {value: 'HhaSync'},
};

// What was exported. Adding a downloadable thing means adding an entry here.
// `resource` is stored as the audit row's resourceName.
const AUDIT_EXPORT_TYPES = {
  REPORT: {value: 'REPORT', resource: 'Report'},
};

const AUDIT_EXPORT_TYPE_VALUES = Object.values(AUDIT_EXPORT_TYPES).map(
  (type) => type.value
);

const AUDIT_EXPORT_FORMATS = {
  PDF: {value: 'PDF'},
  CSV: {value: 'CSV'},
  XLSX: {value: 'XLSX'},
};

const AUDIT_EXPORT_FORMAT_VALUES = Object.values(AUDIT_EXPORT_FORMATS).map(
  (format) => format.value
);

// Caps on the client-supplied export details so a log row stays small.
const AUDIT_EXPORT_TITLE_MAX_LENGTH = 200;
const AUDIT_EXPORT_FILTERS_MAX_BYTES = 4096;

/**
 * Masked out of every audit before/after payload. Both casings are required:
 * camelCase is how config names them, PascalCase is how an HHAeXchange fault
 * echoes them back inside the request envelope.
 */
const AUDIT_CREDENTIAL_MASKED_FIELDS = [
  'appName',
  'appSecret',
  'appKey',
  'AppName',
  'AppSecret',
  'AppKey',
];

// Map HTTP methods to audit actions for controller convenience
const HTTP_METHOD_TO_AUDIT_ACTION = {
  POST: AUDIT_OPERATIONS.CREATE.value,
  GET: AUDIT_OPERATIONS.READ.value,
  PATCH: AUDIT_OPERATIONS.UPDATE.value,
  PUT: AUDIT_OPERATIONS.UPDATE.value,
  DELETE: AUDIT_OPERATIONS.DELETE.value,
};

// Default lookback window (in days) for GET /audit-logs when no explicit
// fromDate/toDate filter is supplied.
const AUDIT_LOGS_DEFAULT_RANGE_DAYS = 7;

// Maximum span (in days) allowed for the GET /audit-logs fromDate/toDate
// window, whether defaulted or explicitly supplied. Caps query cost against
// the AuditLog table for a single request.
const AUDIT_LOGS_MAX_RANGE_DAYS = 30;

module.exports = {
  AUDIT_OPERATIONS,
  AUDIT_OPERATIONS_VALUES,
  AUDIT_RESOURCES,
  AUDIT_EXPORT_TYPES,
  AUDIT_EXPORT_TYPE_VALUES,
  AUDIT_EXPORT_FORMATS,
  AUDIT_EXPORT_FORMAT_VALUES,
  AUDIT_EXPORT_TITLE_MAX_LENGTH,
  AUDIT_EXPORT_FILTERS_MAX_BYTES,
  AUDIT_CREDENTIAL_MASKED_FIELDS,
  HTTP_METHOD_TO_AUDIT_ACTION,
  AUDIT_LOGS_DEFAULT_RANGE_DAYS,
  AUDIT_LOGS_MAX_RANGE_DAYS,
};
