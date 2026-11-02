/**
 * Stores what an HHAeXchange run did: the run row and the exception worklist.
 *
 * Every public method catches and logs its own failure. The import is the job;
 * a history write that fails must never cost the night's data.
 */

const {
  HHA_SYNC_RUN_STATUSES,
  HHA_SYNC_EXCEPTION_STATUSES,
  HHA_SYNC_HISTORY_MAX_LENGTHS,
  HHA_SYNC_HISTORY_BATCH_SIZE,
  HHA_SYNC_EXCEPTION_KEY_SEPARATOR,
  HHA_SYNC_EVENT_ONLY_EXCEPTION_TYPES,
  HHA_SYNC_RUN_HTTP_ERROR_PREFIX,
} = require('../constants/hhaExchangeConstants');
const modelConstants = require('../constants/modelConstants');
const PrismaFactory = require('../factories/PrismaFactory');
const logger = require('../middleware/loggerMiddleware');

const {getCurrentTime} = require('../utils/dateUtils');
const {chunkArray} = require('../utils/general');

const {
  buildSafeRunSummaries,
  resolveRunStatus,
} = require('../utils/hhaExchange/syncRunUtils');

const truncate = ({value, maxLength}) =>
  value === null || value === undefined
    ? null
    : String(value).slice(0, maxLength);

// Record-less problems (a missing id, a feed-wide failure) dedupe on their detail.
const buildDedupeKey = ({resource, type, hhaRecordId, detail}) =>
  truncate({
    value: [
      resource,
      type,
      hhaRecordId ? `id=${hhaRecordId}` : `detail=${detail || ''}`,
    ].join(HHA_SYNC_EXCEPTION_KEY_SEPARATOR),
    maxLength: HHA_SYNC_HISTORY_MAX_LENGTHS.DEDUPE_KEY,
  });

/** One entry per dedupe key; a later repeat in the same run wins. */
const collectRaised = ({summary}) => {
  const raised = new Map();

  summary.exceptions.forEach((exception) => {
    const hhaRecordId = exception.recordId ? String(exception.recordId) : null;

    const detail = truncate({
      value: exception.detail,
      maxLength: HHA_SYNC_HISTORY_MAX_LENGTHS.DETAIL,
    });

    raised.set(
      buildDedupeKey({
        resource: summary.resource,
        type: exception.type,
        hhaRecordId,
        detail,
      }),
      {
        type: exception.type,
        hhaRecordId,
        detail,
        relatedUserId: exception.relatedUserId || null,
      }
    );
  });

  return raised;
};

const findByKeys = async ({organizationId, keys}) => {
  const existing = [];

  for (const batch of chunkArray({
    items: keys,
    size: HHA_SYNC_HISTORY_BATCH_SIZE,
  })) {
    const {success, docs, error} = await PrismaFactory.find({
      model: modelConstants.MODELS.HHA_SYNC_EXCEPTION,
      query: {organizationId, dedupeKey: {in: batch}},
      fieldsInclusion: {include: ['dedupeKey']},
    });

    if (!success) throw error;

    docs.forEach((doc) => existing.push(doc));
  }

  return existing;
};

const updateByIds = async ({ids, data}) => {
  for (const batch of chunkArray({
    items: ids,
    size: HHA_SYNC_HISTORY_BATCH_SIZE,
  })) {
    const {success, error} = await PrismaFactory.updateMany({
      model: modelConstants.MODELS.HHA_SYNC_EXCEPTION,
      query: {id: {in: batch}},
      data,
    });

    if (!success) throw error;
  }
};

const insertNew = async ({organizationId, runId, resource, raised, keys}) => {
  const now = getCurrentTime();

  const rows = keys.map((dedupeKey) => {
    const entry = raised.get(dedupeKey);

    return {
      organizationId,
      dedupeKey,
      resource,
      type: entry.type,
      hhaRecordId: entry.hhaRecordId,
      relatedUserId: entry.relatedUserId,
      detail: entry.detail,
      status: HHA_SYNC_EXCEPTION_STATUSES.OPEN.value,
      firstSeenRunId: runId,
      lastSeenRunId: runId,
      firstSeenAt: now,
      lastSeenAt: now,
    };
  });

  for (const batch of chunkArray({
    items: rows,
    size: HHA_SYNC_HISTORY_BATCH_SIZE,
  })) {
    // skipDuplicates: a concurrent writer for the same key is not an error.
    const {success, error} = await PrismaFactory.create({
      model: modelConstants.MODELS.HHA_SYNC_EXCEPTION,
      data: batch,
      options: {skipDuplicates: true},
    });

    if (!success) throw error;
  }
};

const REOPENABLE_STATUSES = [
  HHA_SYNC_EXCEPTION_STATUSES.RESOLVED.value,
  HHA_SYNC_EXCEPTION_STATUSES.AUTO_RESOLVED.value,
];

/** Count, reopen and refresh rows the run raised again. */
const refreshRepeats = async ({runId, raised, existing}) => {
  if (existing.length === 0) return;

  await updateByIds({
    ids: existing.map((row) => row.id),
    data: {
      occurrences: {increment: 1},
      lastSeenRunId: runId,
      lastSeenAt: getCurrentTime(),
    },
  });

  // resolved* stay as "last closed", so the next admin still sees the note.
  await updateByIds({
    ids: existing
      .filter((row) => REOPENABLE_STATUSES.includes(row.status))
      .map((row) => row.id),
    data: {
      status: HHA_SYNC_EXCEPTION_STATUSES.OPEN.value,
      reopenedAt: getCurrentTime(),
      reopenedByUserId: null,
    },
  });

  // Rare: the same problem now carries a different detail or conflicting user.
  for (const row of existing) {
    const entry = raised.get(row.dedupeKey);

    if (
      entry.detail === row.detail &&
      entry.relatedUserId === row.relatedUserId
    ) {
      continue;
    }

    await updateByIds({
      ids: [row.id],
      data: {detail: entry.detail, relatedUserId: entry.relatedUserId},
    });
  }
};

/**
 * Close OPEN rows this run proved fixed. A record-bound row needs its record
 * seen this run: the visit feed is windowed, so an unseen visit proves nothing.
 */
const autoResolve = async ({organizationId, summary, raised}) => {
  const {success, docs, error} = await PrismaFactory.find({
    model: modelConstants.MODELS.HHA_SYNC_EXCEPTION,
    query: {
      organizationId,
      resource: summary.resource,
      status: HHA_SYNC_EXCEPTION_STATUSES.OPEN.value,
    },
    fieldsInclusion: {include: ['dedupeKey']},
  });

  if (!success) throw error;

  const fixedIds = docs
    .filter(
      (row) =>
        !raised.has(row.dedupeKey) &&
        !HHA_SYNC_EVENT_ONLY_EXCEPTION_TYPES.includes(row.type) &&
        (!row.hhaRecordId || summary.seenRecordIds.has(row.hhaRecordId))
    )
    .map((row) => row.id);

  await updateByIds({
    ids: fixedIds,
    data: {
      status: HHA_SYNC_EXCEPTION_STATUSES.AUTO_RESOLVED.value,
      resolvedAt: getCurrentTime(),
      resolvedByUserId: null,
      resolutionNote: null,
      reopenedAt: null,
      reopenedByUserId: null,
    },
  });
};

const countByType = ({summary}) => {
  const counts = {};

  summary.exceptions.forEach((exception) => {
    counts[exception.type] = (counts[exception.type] || 0) + 1;
  });

  return counts;
};

// Codes only, never HHA's own message text: an HHA or run error id, else the
// HTTP status or transport error name the feed failed with.
const resolveRunErrorId = ({error}) => {
  if (!error) return null;

  if (error.errorId || error.reason) return error.errorId || error.reason;

  if (error.httpStatus) {
    return `${HHA_SYNC_RUN_HTTP_ERROR_PREFIX}${error.httpStatus}`;
  }

  return error.transportError || null;
};

// Code and class only: a Prisma message echoes the rows, which carry HHA data.
const logFailure = ({message, runId, error}) =>
  logger.error(message, {runId, error: error?.code || error?.name || null});

module.exports = class HhaSyncHistoryServices {
  /**
   * Close every RUNNING row as ABANDONED. Only call when no run can be live:
   * the caller holds the run lock, or has just seen that nobody does.
   */
  static async closeAbandonedRuns({organizationId, startedBefore = null}) {
    return await PrismaFactory.updateMany({
      model: modelConstants.MODELS.HHA_SYNC_RUN,
      query: Object.assign(
        {organizationId, status: HHA_SYNC_RUN_STATUSES.RUNNING.value},
        startedBefore ? {startedAt: {lt: startedBefore}} : {}
      ),
      data: {
        status: HHA_SYNC_RUN_STATUSES.ABANDONED.value,
        finishedAt: getCurrentTime(),
      },
    });
  }

  /**
   * Open the run row. A RUNNING row left by a killed process is closed as
   * ABANDONED first: this caller holds the lock, so no other run is live.
   */
  static async startRun({runId, organizationId, trigger, requestedByUserId}) {
    try {
      await HhaSyncHistoryServices.closeAbandonedRuns({organizationId});

      const {success, error} = await PrismaFactory.create({
        model: modelConstants.MODELS.HHA_SYNC_RUN,
        data: {
          id: runId,
          organizationId,
          trigger,
          requestedByUserId: requestedByUserId || null,
          status: HHA_SYNC_RUN_STATUSES.RUNNING.value,
        },
      });

      if (!success) throw error;
    } catch (error) {
      logFailure({
        message: 'HHA sync history: could not open run',
        runId,
        error,
      });
    }
  }

  /** Store and clear the changes a resource has buffered so far. */
  static async flushChanges({runId, organizationId, summary}) {
    const pending = summary.changes.splice(0, summary.changes.length);

    try {
      const rows = pending.map((change) => ({
        organizationId,
        runId,
        resource: summary.resource,
        action: change.action,
        hhaRecordId: change.hhaRecordId,
        changes: change.changes,
      }));

      for (const batch of chunkArray({
        items: rows,
        size: HHA_SYNC_HISTORY_BATCH_SIZE,
      })) {
        const {success, error} = await PrismaFactory.create({
          model: modelConstants.MODELS.HHA_SYNC_CHANGE,
          data: batch,
        });

        if (!success) throw error;
      }
    } catch (error) {
      logFailure({
        message: `HHA sync history: could not store ${summary.resource} changes`,
        runId,
        error,
      });
    }
  }

  /** Store one resource's changes and exceptions; auto-resolve only after a clean pass. */
  static async finishResource({runId, organizationId, summary}) {
    await HhaSyncHistoryServices.flushChanges({runId, organizationId, summary});

    try {
      const raised = collectRaised({summary});
      const keys = Array.from(raised.keys());

      const existing = await findByKeys({organizationId, keys});
      const existingKeys = new Set(existing.map((row) => row.dedupeKey));

      await insertNew({
        organizationId,
        runId,
        resource: summary.resource,
        raised,
        keys: keys.filter((key) => !existingKeys.has(key)),
      });

      await refreshRepeats({runId, raised, existing});

      if (summary.succeeded) {
        await autoResolve({organizationId, summary, raised});
      }
    } catch (error) {
      logFailure({
        message: `HHA sync history: could not store ${summary.resource} exceptions`,
        runId,
        error,
      });
    }
  }

  /** Close the run row with its counters and a code-only error. */
  static async finishRun({runId, summaries, error}) {
    try {
      const safeSummaries = buildSafeRunSummaries({summaries});

      Object.keys(safeSummaries).forEach((summaryKey) => {
        safeSummaries[summaryKey].exceptionsByType = countByType({
          summary: summaries[summaryKey],
        });
      });

      const {success, error: updateError} = await PrismaFactory.updateOne({
        model: modelConstants.MODELS.HHA_SYNC_RUN,
        query: {id: runId},
        data: {
          status: resolveRunStatus({summaries: safeSummaries}),
          errorId: truncate({
            value: resolveRunErrorId({error}),
            maxLength: HHA_SYNC_HISTORY_MAX_LENGTHS.ERROR_ID,
          }),
          summaries: safeSummaries,
          finishedAt: getCurrentTime(),
        },
      });

      if (!success) throw updateError;
    } catch (finishError) {
      logFailure({
        message: 'HHA sync history: could not close run',
        runId,
        error: finishError,
      });
    }
  }
};
