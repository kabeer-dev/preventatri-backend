/**
 * Audit Service
 *
 * Core service for HIPAA-compliant audit logging with:
 * - Automatic request context extraction (IP, userAgent, userId, organizationId)
 */

const auditConfig = require('../config/auditConfig');
const {modelConstants} = require('../constants');
const {PrismaFactory} = require('../factories');
const logger = require('../middleware/loggerMiddleware');
const {enrichAuditLogsPage} = require('../utils/auditUtils');
const {getBasePrismaClient} = require('../utils/databaseConnectionManager');
const {toLuxonUTC} = require('../utils/dateUtils');
const {maskSensitiveFields} = require('../utils/general');
const {getRequestContext} = require('../utils/requestContext');

module.exports = class AuditServices {
  /**
   * Extract request context (IP, userAgent, userId, organizationId) from current request
   */
  static extractRequestContext() {
    try {
      const req = getRequestContext();

      if (!req) return;

      const user = req.extra?.jwtToken?.user;

      return {
        userId: user?.id || null,
        organizationId: user?.currentActiveOrganization?.organizationId || null,

        // Never the left-most X-Forwarded-For: the caller can forge it.
        ipAddress: req.ip || null,
        userAgent: req.headers?.['user-agent'] || null,
        method: req.method || null,
        path: req.originalUrl || req.url || null,

        // Captured directly rather than resolved later via a UserSession
        // lookup, so origin/device stay available on the log even after the
        // session that produced it is revoked or expires.
        sessionId: req.extra?.entities?.session?.id || null,
        platform: req.extra?.flags?.platforms || null,
      };
    } catch {
      return {};
    }
  }

  /**
   * Main audit logging function
   *
   * Automatically extracts userId, organizationId, IP, and userAgent from request context.
   * Pass userId/organizationId explicitly to override (e.g. for login where JWT isn't set yet).
   *
   * Schema: organizationId, userId, resourceId, action, before, after, ipAddress, timestamp, context
   */
  static async logAudit({
    action,
    organizationId = null,
    userId = null,
    resourceName = null,
    resourceId = null,
    before = null,
    after = null,
    context = {},
  }) {
    try {
      const prisma = getBasePrismaClient();
      const reqContext = AuditServices.extractRequestContext();

      // Use explicit overrides if provided, otherwise fall back to request context
      const resolvedUserId = userId || reqContext?.userId || null;

      const resolvedOrgId =
        organizationId || reqContext?.organizationId || null;

      // Merge request context (IP, userAgent) into context automatically
      const resolvedIpAddress = reqContext?.ipAddress || null;

      // eslint-disable-next-line local-rules/no-spread-operator
      const mergedContext = {...reqContext, ...context};

      const mask = ({data}) =>
        maskSensitiveFields({data, fieldsToMask: auditConfig.maskedFields});

      const logEntry = {
        organizationId: resolvedOrgId,
        userId: resolvedUserId,
        resourceName,
        resourceId: resourceId ? String(resourceId) : null,
        action,
        before: before ? mask({data: before}) : null,
        after: after ? mask({data: after}) : null,
        ipAddress: resolvedIpAddress,
        context: Object.keys(mergedContext).length > 0 ? mergedContext : null,
      };

      await prisma.auditLog.create({data: logEntry});
    } catch (err) {
      logger.error(
        `Failed to write audit log [action=${action}, userId=${userId}, organizationId=${organizationId}, resourceId=${resourceId}] resourceName=${resourceName}:`,
        err.message
      );
    }
  }

  /**
   * List audit logs for the read endpoint.
   *
   * organizationId always scopes the query; resourceName, resourceId,
   * action, userId, and the fromDate/toDate timestamp window are all
   * optional and independently combinable -- pass any subset (or none) and
   * only the filters actually supplied narrow the results. Results are
   * ordered by timestamp descending and paginated via skip/take.
   *
   * Every row is returned as the full detail card (generated description,
   * before/after diff, actor + role/region, request origin, related
   * records) -- there's no separate single-log endpoint, this list doubles
   * as it. Enrichment (see utils/auditUtils.js) is batched once per page,
   * not once per row.
   */
  static async listAuditLogs({
    resourceName = null,
    resourceId = null,
    action = null,
    userId = null,
    fromDate = null,
    toDate = null,
    skip = 0,
    take = 10,
  }) {
    try {
      const query = {};

      if (resourceName) query.resourceName = resourceName;
      if (resourceId) query.resourceId = resourceId;
      if (action) query.action = action;
      if (userId) query.userId = userId;

      if (fromDate || toDate) {
        const timestamp = {};
        if (fromDate) timestamp.gte = fromDate;

        // toDate is a calendar day, not a precise instant -- extend it to
        // the end of that day so fromDate === toDate still covers the whole
        // day's logs instead of matching only the exact millisecond.
        if (toDate)
          timestamp.lte = toLuxonUTC({date: toDate}).endOf('day').toJSDate();

        query.timestamp = timestamp;
      }

      const [{success, docs: logs, error}, countResult] = await Promise.all([
        PrismaFactory.find({
          model: modelConstants.MODELS.AUDIT_LOG,
          query,
          options: {sort: {timestamp: 'desc'}, skip, take},
        }),
        PrismaFactory.countDocuments({
          model: modelConstants.MODELS.AUDIT_LOG,
          query,
        }),
      ]);

      if (!success || !countResult.success) {
        return {
          success: false,
          docs: [],
          count: 0,
          error: error || countResult.error,
        };
      }

      const docs = await enrichAuditLogsPage({logs});

      return {success: true, docs, count: countResult.count, error: null};
    } catch (error) {
      return {success: false, docs: [], count: 0, error};
    }
  }
};
