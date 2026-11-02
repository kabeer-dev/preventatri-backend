const {Router} = require('express');

const {
  SYSTEM_ENTITIES,
  CRUD_PERMISSIONS,
} = require('../../constants/aclConstants');

const {AuditLogsController} = require('../../controllers');

const {
  validatorMiddleware,
  catchAsyncMiddleware,
  aclAccessMiddleware,
} = require('../../middleware');

const {auditLogsSchema} = require('../../schemas');

const router = Router();

const AUDIT_LOG_ENTITY = SYSTEM_ENTITIES.auditLog.value;

// 📖 List audit logs, filterable by entity (patient, red flag, etc.)
// GET /audit-logs
// Access: Admins only (auditLog.view permission). Scoped to the caller's
// active organization. resourceType and resourceId are required; action,
// userId, from, to are optional. Ordered by timestamp descending.
router.get(
  '/',

  // Authorize before validating: a non-admin sending a malformed query should
  // get 403 from the permission check, not a 400 that leaks the allowed
  // resourceType/action values.
  aclAccessMiddleware({
    entityToCheck: AUDIT_LOG_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  validatorMiddleware({
    validateFunction: auditLogsSchema.validateListAuditLogsQuery,
    reqProperty: 'query',
  }),
  catchAsyncMiddleware(AuditLogsController.listAuditLogs)
);

// 📝 Record a client-side export (PDF/CSV/...) in the audit log
// POST /audit-logs/exports
// Access: whoever can view reports (report.view), the only exportType so far.
router.post(
  '/exports',
  validatorMiddleware({
    validateFunction: auditLogsSchema.validateLogExportBody,
    reqProperty: 'body',
  }),
  aclAccessMiddleware({
    entityToCheck: SYSTEM_ENTITIES.report.value,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(AuditLogsController.logExport)
);

module.exports = router;
