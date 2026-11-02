const {
  AUDIT_OPERATIONS,
  AUDIT_EXPORT_TYPES,
} = require('../constants/auditConstants');
const {AUDIT_RESOURCE_TYPES} = require('../constants/requestLoggerConstants');

const {
  GeneralErrorsFactories,
  AuditLogsResponsesFactories,
} = require('../factories');

const {AuditServices} = require('../services');
const {getListParams} = require('../utils/general');

module.exports = class AuditLogsController {
  /**
   * List audit logs, filterable by entity. Each row is returned as a full
   * detail card (generated description, before/after diff, actor +
   * role/region, request origin, related records) -- there's no separate
   * single-log endpoint.
   * GET /audit-logs
   *
   * Query params: resourceType, resourceId, action, userId, fromDate, and
   * toDate are all optional and independently combinable -- pass any subset
   * (or none) and only the supplied filters narrow the results.
   * `fromDate`/`toDate` default to the trailing week and the window can't
   * exceed AUDIT_LOGS_MAX_RANGE_DAYS (validated by route middleware).
   * page/limit paginate the results (limit defaults to 10, also validated by
   * route middleware). Scoped to the caller's active organization. Admin only.
   */
  static async listAuditLogs(req, res, next) {
    // Query params are already validated by route middleware.
    const {resourceType, resourceId, action, userId, fromDate, toDate} =
      req.query;
    const {page, limit, skip} = getListParams({req});

    // Translate the friendly resourceType key to the stored resourceName label.
    const resourceName = AUDIT_RESOURCE_TYPES[resourceType];

    const {
      success,
      docs: auditLogs,
      count,
      error,
    } = await AuditServices.listAuditLogs({
      resourceName,
      resourceId,
      action,
      userId,
      fromDate,
      toDate,
      skip,
      take: limit,
    });

    if (!success || error)
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch audit logs',
      });

    return AuditLogsResponsesFactories.auditLogsListed({
      auditLogs,
      meta: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        count,
        totalPages: Math.ceil(count / limit),
      },
    });
  }

  /**
   * Record that the caller downloaded an export (PDF/CSV/...) built in the
   * browser, so the backend would otherwise never see it. Generic on purpose:
   * any export screen reports through here with its `exportType`.
   * POST /audit-logs/exports
   *
   * Body: exportType, format (both required); title, filters, recordCount
   * (optional, describe what was exported -- never the exported data itself).
   * Body is validated and the exportType's permission checked by route
   * middleware. Scoped to the caller's active organization.
   */
  static async logExport(req, res, next) {
    const {exportType, format, title, filters, recordCount} = req.body;

    await AuditServices.logAudit({
      action: AUDIT_OPERATIONS.DATA_EXPORTED.value,
      resourceName: AUDIT_EXPORT_TYPES[exportType].resource,
      after: {format, title, filters, recordCount},
    });

    return AuditLogsResponsesFactories.dataExportLogged();
  }
};
