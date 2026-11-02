/**
 * Audit Utilities
 *
 * Batched enrichment for the audit log list endpoint: turns a page of raw
 * AuditLog rows into detail cards (generated description, before/after
 * diff, actor + role, request origin). Every DB lookup here is batched once
 * per page (one query per entity type), not once per row -- see
 * enrichAuditLogsPage.
 */

const {modelConstants} = require('../constants');

const {
  buildAuditSummary,
  buildWhatChanged,
  formatAuditRoleLabel,
  parseAuditDevice,
  resolveAuditOrigin,
} = require('./auditLogFormatUtils');

const {
  AUDIT_ROUTE_CONFIG,
  AUDIT_RESOURCE_TYPES,
} = require('../constants/requestLoggerConstants');
const {PrismaFactory} = require('../factories');

/**
 * Reverse of AUDIT_RESOURCE_TYPES: AuditLog.resourceName (the stored label,
 * e.g. "Emergency Flag") -> the stable resourceType key (e.g.
 * "emergencyFlag"), returned on each row and used below to look up its
 * Prisma model.
 */
const RESOURCE_LABEL_TO_TYPE = Object.entries(AUDIT_RESOURCE_TYPES).reduce(
  (map, [type, label]) => Object.assign(map, {[label]: type}),
  {}
);

/**
 * resourceType -> Prisma model, straight from AUDIT_ROUTE_CONFIG. Used to
 * fetch the actual record a log's resourceId points to, so its name can be
 * read directly off the current row instead of guessed from the stored
 * before/after JSON.
 */
const MODEL_BY_RESOURCE_TYPE = Object.values(AUDIT_ROUTE_CONFIG).reduce(
  (map, {resourceType, model}) => Object.assign(map, {[resourceType]: model}),
  {}
);

/**
 * A handful of models store their display name on a relation rather than a
 * direct field (profiles link to User; assessment-adjacent records link to
 * Patient) -- fetched with that relation included so extractAuditSubjectName
 * can find it. Every other model needs no include; its own fields already
 * carry a name/title extractAuditSubjectName recognizes.
 */
const SUBJECT_RECORD_INCLUDES = {
  [modelConstants.MODELS.NURSE_PROFILE]: ['user'],
  [modelConstants.MODELS.CAREGIVER_PROFILE]: ['user'],
  [modelConstants.MODELS.CASE_MANAGER_PROFILE]: ['user'],
  [modelConstants.MODELS.CHECKLIST_SUBMISSION]: ['patient'],
  [modelConstants.MODELS.CHECKLIST_ASSIGNMENT]: ['patient'],
  [modelConstants.MODELS.SUPERVISORY_VISIT]: ['patient'],
  [modelConstants.MODELS.FOLLOW_UP_TASK]: ['patient'],
  [modelConstants.MODELS.SUBMISSION_FLAG]: ['patient'],
  [modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION]: ['patient'],
};

/**
 * Collapse a list to its unique, non-empty values -- used throughout below
 * to turn "one field across N logs" into the id list for a single batched
 * query, instead of querying per log.
 */
const uniqueValues = ({values}) => Array.from(new Set(values.filter(Boolean)));

/**
 * Index a list of docs by one of their fields, keeping the first doc seen
 * per key.
 */
const indexBy = ({docs, key}) =>
  docs.reduce((map, doc) => {
    if (!(doc[key] in map)) map[doc[key]] = doc;

    return map;
  }, {});

/**
 * The stable resourceType a log belongs to, returned on each row and used
 * to look up its Prisma model for the subject-record fetch below.
 */
const describeLog = ({log}) => ({
  resourceType: RESOURCE_LABEL_TO_TYPE[log.resourceName] || null,
});

// ── Batched lookups -- one query per entity type for the whole page, not per log ──

const batchFetchUsersById = async ({userIds}) => {
  if (userIds.length === 0) return {};

  const {success, docs} = await PrismaFactory.find({
    model: modelConstants.MODELS.USER,
    query: {id: {in: userIds}},
    fieldsInclusion: {include: ['userOrganizations']},
  });

  return success ? indexBy({docs, key: 'id'}) : {};
};

/**
 * Combine a userId + organizationId into one map key. A page can (in
 * principle) contain logs from more than one org, and the same user id can
 * carry a different role in each org, so the role lookup below is keyed on
 * the pair rather than on userId alone.
 */
const userOrgKey = ({userId, organizationId}) => `${userId}::${organizationId}`;

/**
 * Fetch the current row for every (model, id) pair referenced by the page's
 * resourceIds, one query per distinct model regardless of how many logs
 * point at that model. This is the single source of truth for a log's
 * subject name -- reading the record fresh means the name is always right,
 * with no dependency on before/after ever having been captured for that
 * action. Returns null for ids the query didn't find (e.g. a DELETEd row --
 * the caller falls back to the log's own before/after snapshot for that).
 */
const batchFetchSubjectRecordsByModel = async ({idsByModel}) => {
  const models = Object.keys(idsByModel).filter(
    (model) => idsByModel[model].length > 0
  );

  if (models.length === 0) return {};

  const results = await Promise.all(
    models.map((model) => {
      const findArgs = {model, query: {id: {in: idsByModel[model]}}};

      if (SUBJECT_RECORD_INCLUDES[model]) {
        findArgs.fieldsInclusion = {include: SUBJECT_RECORD_INCLUDES[model]};
      }

      return PrismaFactory.find(findArgs);
    })
  );

  return models.reduce((byModel, model, index) => {
    const {success, docs} = results[index];

    byModel[model] = success ? indexBy({docs, key: 'id'}) : {};

    return byModel;
  }, {});
};

/**
 * Enrich a page of raw AuditLog rows into detail cards (generated
 * description, before/after diff, actor + role, request origin). Every
 * lookup below is batched across the whole page -- one query per entity
 * type (users, subject records by model) regardless of how many rows are
 * on the page, instead of querying per row.
 */
module.exports.enrichAuditLogsPage = async ({logs}) => {
  if (logs.length === 0) return [];

  const describedByLogId = logs.reduce(
    (map, log) => Object.assign(map, {[log.id]: describeLog({log})}),
    {}
  );

  const userIds = uniqueValues({values: logs.map((log) => log.userId)});

  // One id list per model, built from each log's resourceType -> model
  // mapping -- however many resource types are on the page, one query each.
  const idsByModel = logs.reduce((map, log) => {
    const {resourceType} = describedByLogId[log.id];
    const model = MODEL_BY_RESOURCE_TYPE[resourceType];

    if (!model || !log.resourceId) return map;

    map[model] = map[model] || [];
    map[model].push(log.resourceId);

    return map;
  }, {});

  Object.keys(idsByModel).forEach((model) => {
    idsByModel[model] = uniqueValues({values: idsByModel[model]});
  });

  const [usersById, subjectRecordsByModel] = await Promise.all([
    batchFetchUsersById({userIds}),
    batchFetchSubjectRecordsByModel({idsByModel}),
  ]);

  // Keyed on (userId, organizationId) rather than userId alone: the same
  // user can hold a different role in a different org, and each log's own
  // organizationId is the correct scope for resolving their role on it.
  const membershipByKey = logs.reduce((map, log) => {
    const key = userOrgKey({
      userId: log.userId,
      organizationId: log.organizationId,
    });

    if (key in map) return map;

    const memberships = usersById[log.userId]?.userOrganizations || [];

    map[key] = memberships.find(
      (org) => org.organizationId === log.organizationId
    );

    return map;
  }, {});

  return logs.map((log) => {
    const {resourceType} = describedByLogId[log.id];
    const user = usersById[log.userId] || null;

    const key = userOrgKey({
      userId: log.userId,
      organizationId: log.organizationId,
    });
    const membership = membershipByKey[key];

    const context = log.context || {};

    // A row the system wrote on its own (e.g. an escalation step) has no user.
    const systemActorName =
      !log.userId && context.trigger === 'SYSTEM' ? 'System' : null;

    const actorName = user
      ? [user.firstName, user.lastName].filter(Boolean).join(' ') || null
      : systemActorName;
    const actorRoleLabel = formatAuditRoleLabel({role: membership?.role});

    const model = MODEL_BY_RESOURCE_TYPE[resourceType];

    // The record's current row, fresh off the DB -- the primary source for
    // its display name. Falls back to the stored after/before snapshot only
    // when the fresh fetch has nothing (e.g. the row was deleted, or there
    // was no resourceId/model to look up in the first place).
    const subjectSnapshot =
      (model &&
        log.resourceId &&
        subjectRecordsByModel[model]?.[log.resourceId]) ||
      log.after ||
      log.before ||
      null;

    return {
      id: log.id,
      resourceType,
      resourceLabel: log.resourceName,
      action: log.action,
      description: buildAuditSummary({
        action: log.action,
        resourceLabel: log.resourceName,
        resourceId: log.resourceId,
        actorName,
        snapshot: subjectSnapshot,
      }),
      timestamp: log.timestamp,
      whatChanged: buildWhatChanged({
        action: log.action,
        before: log.before,
        after: log.after,
        resourceLabel: log.resourceName,
        resourceId: log.resourceId,
        actorName,
        snapshot: subjectSnapshot,
      }),
      actor: {
        id: log.userId,
        name: actorName,
        role: actorRoleLabel,
      },
      origin: {
        ipAddress: log.ipAddress,
        device: parseAuditDevice({userAgent: context.userAgent}),
        type: resolveAuditOrigin({
          platform: context.platform,
          userAgent: context.userAgent,
        }),
      },
    };
  });
};
