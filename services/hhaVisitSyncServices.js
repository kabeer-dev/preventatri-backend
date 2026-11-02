/**
 * HHAeXchange -> PreventaTri visit reconciliation.
 *
 * One-way by design: PreventaTri never writes back to HHAeXchange.
 *
 * One HHAeXchange visit is one HhaVisit row. In HHAeXchange a schedule and a
 * visit are the same record, so the row carries both the planned window and
 * what actually happened, and the HHA Visits page is a read-only view of it.
 * The row is standalone: it stores the HHAeXchange patient and caregiver ids
 * with a name snapshot and is never resolved against PreventaTri's own patient
 * or caregiver tables, so this runner shares nothing with the others and can
 * sit anywhere in the registry.
 *
 * Two passes, in this order:
 *  1. The change feed (GetVisitChangesV5), upserting rows hash-gated exactly
 *     like the patient runner.
 *  2. The deleted feed (GetDeletedVisitsV2), marking rows DELETED. The change
 *     feed never reports a deletion -- a cancelled visit simply stops appearing
 *     -- so the second pass is the only signal, and running it second means a
 *     visit modified and then deleted in the same window ends DELETED rather
 *     than being resurrected as SCHEDULED.
 *
 * Both feeds are WINDOWED (about one month of changes per call), so each pass
 * is a walkFeedByCursor rather than a single walkPagedFeed, and the resource
 * runs on its own short lookback -- see HHAX_SYNC_RESOURCES.
 */

const config = require('config');

const HhaExchangeServices = require('./hhaExchangeServices');

const {
  HHA_SYNC_CHANGE_ACTIONS,
  HHA_SYNC_CHANGE_FIELDS,
  HHA_VISIT_TRACKED_FIELDS,
  HHAX_DELETED_VISIT_ELEMENTS,
  HHAX_SYNC_EXCEPTION_TYPES,
  HHAX_VISIT_ELEMENTS,
  HHAX_VISIT_MODIFIED_AFTER_FORMAT,
} = require('../constants/hhaExchangeConstants');
const {HHA_VISIT_STATUSES} = require('../constants/hhaVisitsConstants');
const modelConstants = require('../constants/modelConstants');
const PrismaFactory = require('../factories/PrismaFactory');
const logger = require('../middleware/loggerMiddleware');

const {getCurrentTime} = require('../utils/dateUtils');

const {
  diffFields,
  snapshotFields,
} = require('../utils/hhaExchange/syncChangeUtils');

const {
  markRecordSeen,
  recordChange,
  recordException,
  walkFeedByCursor,
} = require('../utils/hhaExchange/syncRunUtils');

const {
  mapHhaVisit,
  computeVisitSyncHash,
  mapDeletedVisit,
} = require('../utils/hhaExchange/visitMapper');

/**
 * Map, fingerprint and validate one page, without touching the database.
 *
 * @returns {{prepared: Object[], unresolvedReasonIds: Set<string>}}
 */
const prepareRecords = ({records, summary, reasonsById, defaultTimeZone}) => {
  // Keyed by visit id: HHAeXchange can list the same VisitID twice on one page
  // (observed live 2026-09-05), and two rows for one key would turn the page's
  // createMany into a unique-constraint failure. The LAST occurrence wins, on
  // the assumption the feed is oldest-first within a page.
  const preparedByVisitId = new Map();
  const unresolvedReasonIds = new Set();

  for (const record of records) {
    summary.seen += 1;

    const mapping = mapHhaVisit({record, reasonsById, defaultTimeZone});

    markRecordSeen({summary, recordId: mapping.hhaVisitId});

    mapping.exceptions.forEach((exception) =>
      recordException({
        summary,
        recordId: mapping.hhaVisitId,
        type: exception.type,
        detail: exception.detail,
      })
    );

    // Collected rather than reported per record: the master list is missing
    // whole ranges of ids, so one exception per missed visit would bury every
    // other outcome in the summary. Reported once for the run instead.
    if (mapping.unresolvedMissedReasonId) {
      unresolvedReasonIds.add(String(mapping.unresolvedMissedReasonId));
    }

    if (!mapping.isValid) {
      if (!mapping.hhaVisitId) {
        recordException({
          summary,
          recordId: null,
          type: HHAX_SYNC_EXCEPTION_TYPES.MISSING_VISIT_ID,
        });
      }

      summary.failed += 1;

      continue;
    }

    if (preparedByVisitId.has(mapping.hhaVisitId)) summary.skipped += 1;

    preparedByVisitId.set(mapping.hhaVisitId, {
      hhaVisitId: mapping.hhaVisitId,
      mapped: mapping.mapped,
      syncHash: computeVisitSyncHash({mapped: mapping.mapped}),
    });
  }

  return {
    prepared: Array.from(preparedByVisitId.values()),
    unresolvedReasonIds,
  };
};

const recordVisitCreate = ({summary, row}) =>
  recordChange({
    summary,
    recordId: row.hhaVisitId,
    action: HHA_SYNC_CHANGE_ACTIONS.CREATED.value,
    changes: snapshotFields({
      after: row,
      fields: HHA_VISIT_TRACKED_FIELDS,
    }),
  });

/**
 * Create the visits on this page that PreventaTri has never seen.
 *
 * One createMany for the whole batch, falling back to individual inserts if it
 * fails -- the fallback is what keeps the run honest, exactly as on patients.
 */
const createNewVisits = async ({toCreate, organizationId, summary}) => {
  if (toCreate.length === 0) return;

  const rows = toCreate.map((entry) =>
    Object.assign({}, entry.mapped, {
      organizationId,
      hhaVisitId: entry.hhaVisitId,
      hhaSyncHash: entry.syncHash,
      hhaLastSyncedAt: getCurrentTime(),
    })
  );

  const {success} = await PrismaFactory.create({
    model: modelConstants.MODELS.HHA_VISIT,
    data: rows,
    options: {bypassExtraQueries: true},
  });

  if (success) {
    summary.created += rows.length;
    rows.forEach((row) => recordVisitCreate({summary, row}));

    return;
  }

  for (let index = 0; index < rows.length; index += 1) {
    const outcome = await PrismaFactory.create({
      model: modelConstants.MODELS.HHA_VISIT,
      data: rows[index],
      options: {bypassExtraQueries: true},
    });

    if (outcome.success) {
      summary.created += 1;
      recordVisitCreate({summary, row: rows[index]});

      continue;
    }

    recordException({
      summary,
      recordId: toCreate[index].hhaVisitId,
      type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
      detail: outcome.error?.code || null,
    });
    summary.failed += 1;
  }
};

/**
 * The update payload for a row whose fingerprint changed.
 *
 * A row already marked DELETED keeps that status. The change feed can still
 * present a deleted visit (its LastModifiedDate moves when it is deleted), and
 * the mapper can only ever derive a live status from it, so writing `status`
 * through would resurrect the visit on the very next run.
 */
const buildUpdateData = ({entry, existing}) => {
  const data = Object.assign({}, entry.mapped, {
    hhaSyncHash: entry.syncHash,
    hhaLastSyncedAt: getCurrentTime(),
  });

  if (existing.status === HHA_VISIT_STATUSES.DELETED.value) {
    delete data.status;
  }

  return data;
};

/**
 * Refresh the visits on this page whose HHAeXchange-owned fields changed.
 *
 * includeDeleted is load-bearing for the same reason as on patients: an
 * archived row must be updated IN PLACE, leaving deleted_at untouched.
 */
const updateChangedVisits = async ({toUpdate, summary}) => {
  for (const {entry, existing} of toUpdate) {
    const data = buildUpdateData({entry, existing});

    const {success, error} = await PrismaFactory.updateOne({
      model: modelConstants.MODELS.HHA_VISIT,
      query: {id: existing.id},
      data,
      options: {bypassExtraQueries: true, includeDeleted: true},
    });

    if (!success) {
      recordException({
        summary,
        recordId: entry.hhaVisitId,
        type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
        detail: error?.code || null,
      });
      summary.failed += 1;

      continue;
    }

    summary.updated += 1;

    recordChange({
      summary,
      recordId: entry.hhaVisitId,
      action: HHA_SYNC_CHANGE_ACTIONS.UPDATED.value,
      changes: diffFields({
        before: existing,
        after: data,
        fields: HHA_VISIT_TRACKED_FIELDS,
      }),
    });
  }
};

/**
 * Reconcile one page of the change feed.
 *
 * Batched on the same reasoning as the patient runner: one read, one bulk touch
 * for the unchanged majority, and a write only for records that actually differ.
 */
const processVisitPage = async ({
  records,
  organizationId,
  summary,
  reasonsById,
  defaultTimeZone,
  unresolvedReasonIds,
}) => {
  const {prepared, unresolvedReasonIds: pageUnresolved} = prepareRecords({
    records,
    summary,
    reasonsById,
    defaultTimeZone,
  });

  pageUnresolved.forEach((id) => unresolvedReasonIds.add(id));

  if (prepared.length === 0) return {success: true};

  // hhaSyncHash MUST be requested explicitly: it is deliberately absent from
  // the default field set (see modelSchemaConfig), and a plain read would
  // return it as undefined, never match a freshly computed hash, and send
  // every record down the write path on every run. status comes back so a
  // DELETED row can be recognised -- see buildUpdateData.
  const {success: lookupSucceeded, docs: existingDocs} =
    await PrismaFactory.find({
      model: modelConstants.MODELS.HHA_VISIT,
      query: {
        organizationId,
        hhaVisitId: {in: prepared.map((entry) => entry.hhaVisitId)},
      },
      options: {bypassExtraQueries: true, includeDeleted: true},

      // The tracked fields are the "before" of the change history.
      fieldsInclusion: {
        includeSpecificFields: ['id', 'hhaVisitId', 'hhaSyncHash'].concat(
          HHA_VISIT_TRACKED_FIELDS
        ),
      },
    });

  // A failed lookup must never masquerade as an empty result: every record
  // would be classified as new and the page would go in as duplicate inserts.
  if (!lookupSucceeded) {
    return {success: false};
  }

  const existingByHhaId = new Map(
    existingDocs.map((doc) => [doc.hhaVisitId, doc])
  );

  const unchangedIds = [];
  const toUpdate = [];
  const toCreate = [];

  for (const entry of prepared) {
    const existing = existingByHhaId.get(entry.hhaVisitId);

    if (!existing) {
      toCreate.push(entry);

      continue;
    }

    if (existing.hhaSyncHash === entry.syncHash) {
      unchangedIds.push(existing.id);

      continue;
    }

    toUpdate.push({entry, existing});
  }

  if (unchangedIds.length > 0) {
    await PrismaFactory.updateMany({
      model: modelConstants.MODELS.HHA_VISIT,
      query: {id: {in: unchangedIds}},
      data: {hhaLastSyncedAt: getCurrentTime()},
      options: {bypassExtraQueries: true, includeDeleted: true},
    });
    summary.skipped += unchangedIds.length;
  }

  await updateChangedVisits({toUpdate, summary});
  await createNewVisits({toCreate, organizationId, summary});

  return {success: true};
};

/**
 * Reconcile one page of the deleted-visit feed.
 *
 * A deleted visit is MARKED, never removed: the row keeps its schedule, gains a
 * reason, and stays visible so a cancelled visit is still auditable. Visits
 * deleted before PreventaTri ever imported them are silently fine -- there is
 * nothing to mark -- and rows already DELETED are left alone.
 *
 * `seen` counts deleted-feed records too, so for VISITS it is the sum of both
 * feeds; `updated` is the rows newly marked, `skipped` the rest.
 */
const processDeletedVisitPage = async ({records, organizationId, summary}) => {
  const mapped = records
    .map((record) => mapDeletedVisit({record}))
    .filter((entry) => entry.hhaVisitId);

  if (mapped.length === 0) return {success: true};

  summary.seen += mapped.length;
  mapped.forEach((entry) =>
    markRecordSeen({summary, recordId: entry.hhaVisitId})
  );

  const byVisitId = new Map(mapped.map((entry) => [entry.hhaVisitId, entry]));

  const {success: lookupSucceeded, docs: existingDocs} =
    await PrismaFactory.find({
      model: modelConstants.MODELS.HHA_VISIT,
      query: {organizationId, hhaVisitId: {in: Array.from(byVisitId.keys())}},
      options: {bypassExtraQueries: true, includeDeleted: true},
      fieldsInclusion: {includeSpecificFields: ['id', 'hhaVisitId', 'status']},
    });

  if (!lookupSucceeded) return {success: false};

  let marked = 0;

  for (const existing of existingDocs) {
    if (existing.status === HHA_VISIT_STATUSES.DELETED.value) continue;

    const entry = byVisitId.get(existing.hhaVisitId);

    const {success, error} = await PrismaFactory.updateOne({
      model: modelConstants.MODELS.HHA_VISIT,
      query: {id: existing.id},
      data: {
        status: HHA_VISIT_STATUSES.DELETED.value,
        hhaDeletedAt: entry.deletedAt,
        hhaDeletedReason: entry.deletedReason,
        hhaLastSyncedAt: getCurrentTime(),
      },
      options: {bypassExtraQueries: true, includeDeleted: true},
    });

    if (!success) {
      recordException({
        summary,
        recordId: existing.hhaVisitId,
        type: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED,
        detail: error?.code || null,
      });

      continue;
    }

    marked += 1;

    recordChange({
      summary,
      recordId: existing.hhaVisitId,
      action: HHA_SYNC_CHANGE_ACTIONS.DELETED_IN_HHA.value,
      changes: [
        {
          field: HHA_SYNC_CHANGE_FIELDS.STATUS,
          from: existing.status,
          to: HHA_VISIT_STATUSES.DELETED.value,
        },
      ],
    });
  }

  summary.updated += marked;
  summary.skipped += mapped.length - marked;

  return {success: true};
};

module.exports = class HhaVisitSyncServices {
  /**
   * Reconcile the visit change feed, then the deleted-visit feed.
   *
   * One of the runners HhaSyncServices.runSync iterates. The lock, the
   * organization resolution and the summary lifecycle belong to the
   * orchestrator; this only walks the feeds and writes.
   *
   * @param {Object} params
   * @param {string} params.organizationId
   * @param {string} params.modifiedAfter - Already formatted, WITHOUT the Z.
   * @param {Object} params.summary - Mutated in place with the counters.
   * @returns {Promise<{success: boolean, error: Object|null}>}
   */
  static async runResourceSync({organizationId, modifiedAfter, summary}) {
    // Not fatal: a failed master list only costs the human-readable reason
    // text. The raw MissedVisitReasonID is stored regardless.
    const {reasonsById} = await HhaExchangeServices.fetchMissedVisitReasons();

    // The zone a clock time is read in when the record's own TimeZone element
    // is absent or unmapped. Same value the cron is scheduled in.
    const defaultTimeZone = config.get('hhax.syncTimezone');
    const unresolvedReasonIds = new Set();

    // Both feeds are windowed the same way, so both walks share the cursor
    // format and the empty-window step.
    const cursorFormat = HHAX_VISIT_MODIFIED_AFTER_FORMAT;
    const emptyWindowStepDays = config.get('hhax.visitCursorStepDays');

    const changesOutcome = await walkFeedByCursor({
      startCursor: modifiedAfter,
      cursorFormat,
      emptyWindowStepDays,
      element: HHAX_VISIT_ELEMENTS.LAST_MODIFIED_DATE,
      summary,
      fetchPage: async ({modifiedAfter: cursor, pageNumber}) =>
        await HhaExchangeServices.fetchVisitChanges({
          modifiedAfter: cursor,
          pageNumber,
        }),
      processPage: async ({records}) =>
        await processVisitPage({
          records,
          organizationId,
          summary,
          reasonsById,
          defaultTimeZone,
          unresolvedReasonIds,
        }),
    });

    // Once per run, not once per record: the agency master list is missing
    // whole ranges of the ids the feed actually uses, so per-record reporting
    // would bury every other outcome in the summary.
    if (unresolvedReasonIds.size > 0) {
      recordException({
        summary,
        recordId: null,
        type: HHAX_SYNC_EXCEPTION_TYPES.UNMAPPED_MISSED_REASON,
        detail: Array.from(unresolvedReasonIds).join(', '),
      });
      logger.warn(
        'HHAeXchange missed-visit reason ids absent from master list',
        {count: unresolvedReasonIds.size}
      );
    }

    if (!changesOutcome.success) return changesOutcome;

    // Chained for the same reason as the change feed: one call answers with a
    // single window, so a deletion outside it would never be seen.
    return await walkFeedByCursor({
      startCursor: modifiedAfter,
      cursorFormat,
      emptyWindowStepDays,
      element: HHAX_DELETED_VISIT_ELEMENTS.LAST_MODIFIED_DATE,
      summary,
      fetchPage: async ({modifiedAfter: cursor, pageNumber}) =>
        await HhaExchangeServices.fetchDeletedVisits({
          modifiedAfter: cursor,
          pageNumber,
        }),
      processPage: async ({records}) =>
        await processDeletedVisitPage({records, organizationId, summary}),
    });
  }
};
