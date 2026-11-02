/**
 * Bookkeeping shared by every HHAeXchange sync resource.
 *
 * The run summary carries the counters and every per-record exception until
 * HhaSyncHistoryServices stores them. Silence is the worst outcome.
 *
 * Extracted from hhaSyncServices when caregivers joined the run: the counters
 * and the pagination walk are identical for every resource, and only the
 * fetch and the reconcile differ.
 */

const config = require('config');

const {
  getCurrentUTCISO,
  getUTCDaysAgoFormatted,
  addToFormattedUTC,
} = require('../dateUtils');
const {normalizeValue} = require('./soapClient');

const {
  HHAX_FIRST_PAGE_NUMBER,
  HHA_SYNC_CHANGE_ACTIONS,
  HHAX_SYNC_EXCEPTION_TYPES,
  HHAX_SYNC_RESOURCES,
  HHA_SYNC_RUN_STATUSES,
  HHA_SYNC_WARNING_EXCEPTION_TYPES,
} = require('../../constants/hhaExchangeConstants');
const logger = require('../../middleware/loggerMiddleware');

/**
 * A fresh, zeroed counter set for one resource within one run.
 *
 * @param {Object} params
 * @param {string} params.trigger - An HHAX_SYNC_TRIGGERS value.
 * @param {string} params.resource - An HHAX_SYNC_RESOURCES value.
 * @param {string} params.organizationId
 */
const buildSummary = ({trigger, resource, organizationId}) => ({
  trigger,
  resource,
  organizationId,
  startedAt: getCurrentUTCISO(),
  finishedAt: null,
  seen: 0,
  created: 0,
  updated: 0,
  skipped: 0,

  // Not imported or updated because of an exception; kept out of skipped.
  failed: 0,

  // Link counters sit apart from `updated`: they are not hash-gated, so an
  // otherwise unchanged record can still gain a county, region, nurse, CM or email.
  countiesResolved: 0,
  primaryRegionsChanged: 0,
  nurseLinksChanged: 0,
  caseManagerLinksChanged: 0,
  emailsChanged: 0,

  // Uncapped: every exception is stored. Only counts ever reach logs or sockets.
  exceptions: [],

  // HHA ids this run read; lets the history auto-resolve what no longer recurs.
  seenRecordIds: new Set(),

  // Created/changed records, stored by HhaSyncHistoryServices.flushChanges.
  changes: [],
});

/** Note that this run read the HHA record, whether or not it imported. */
const markRecordSeen = ({summary, recordId}) => {
  if (recordId) summary.seenRecordIds.add(String(recordId));
};

/**
 * Record one per-record outcome.
 *
 * `recordId` is the HHAeXchange id of the record it happened to (PatientID or
 * CaregiverID) -- deliberately resource-agnostic so one exception shape covers
 * every feed.
 */
const recordException = ({summary, recordId, type, detail, relatedUserId}) => {
  summary.exceptions.push({
    recordId: recordId || null,
    type,
    detail: detail || null,
    relatedUserId: relatedUserId || null,
  });
};

/**
 * Record one record the run created or changed. An update whose fields all
 * came out equal (the hash moved on a field the history does not track) is
 * dropped rather than stored as an empty change.
 */
const recordChange = ({summary, recordId, action, changes = []}) => {
  if (!recordId) return;

  if (
    changes.length === 0 &&
    action !== HHA_SYNC_CHANGE_ACTIONS.CREATED.value
  ) {
    return;
  }

  summary.changes.push({hhaRecordId: String(recordId), action, changes});
};

/**
 * Walk every page of a paginated HHAeXchange change feed.
 *
 * One walk, not one per office: omitting OfficeID from the request returns every
 * office's records in a single feed, and each record carries its own OfficeID.
 *
 * @param {Object} params
 * @param {Function} params.fetchPage - ({pageNumber}) => {success, docs, pagination, error}
 * @param {Function} params.processPage - ({records}) => {success}
 * @returns {Promise<{success: boolean, error: Object|null}>}
 */
const walkPagedFeed = async ({fetchPage, processPage}) => {
  const maxPages = config.get('hhax.maxPages');
  let pageNumber = HHAX_FIRST_PAGE_NUMBER;

  for (;;) {
    const page = await fetchPage({pageNumber});

    if (!page.success) {
      return {success: false, error: page.error};
    }

    const pageOutcome = await processPage({records: page.docs});

    // The page could not be reconciled against what is already stored, so
    // continuing would import against an unknown baseline.
    if (!pageOutcome.success) {
      return {
        success: false,
        error: {reason: HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED},
      };
    }

    const isLastPage =
      page.docs.length === 0 ||
      page.pagination.totalPages === 0 ||
      pageNumber >= page.pagination.totalPages;

    // Runaway guard: a service that always reports one more page would
    // otherwise loop forever.
    if (isLastPage || pageNumber - HHAX_FIRST_PAGE_NUMBER + 1 >= maxPages) {
      return {success: true, error: null};
    }

    pageNumber += 1;
  }
};

/**
 * Newest raw LastModifiedDate on a page, as the feed sent it.
 *
 * Read raw rather than from the mapped record so the cursor is expressed in
 * HHAeXchange's own clock, exactly as it will be sent back. The feed's
 * "yyyy-MM-dd HH:mm:ss.SSS" shape sorts correctly as a plain string.
 */
const readNewestModified = ({records, element}) => {
  let newest = null;

  for (const record of records) {
    const value = normalizeValue({value: record[element]});

    if (value && (!newest || value > newest)) newest = value;
  }

  return newest;
};

/**
 * "2026-01-29 17:08:37.513" -> "2026-01-29T17:08:37".
 *
 * Truncating the milliseconds rounds the cursor DOWN, which can only re-present
 * records already seen -- harmless, because the hash gate turns a repeat into a
 * no-op. Rounding up would skip them.
 */
const toCursor = ({value}) => value.replace(' ', 'T').slice(0, 19);

const ONE_SECOND = {seconds: 1};

/**
 * Walk a WINDOWED change feed forward in time until it reaches the present.
 *
 * GetVisitChangesV5 does NOT return everything modified since ModifiedAfter: it
 * answers with a fixed span of roughly ONE MONTH after it and stops, however
 * much is left. Measured on the sandbox 2026-09-01 -- from 2026-01-01, six
 * chained calls returned 2841, 2793, 2805, 4451, 7340 and 6869 records, each
 * covering about thirty days.
 *
 * So a single call can never reach the present unless ModifiedAfter is already
 * within a month of it. A 90-day lookback issued as ONE request would import
 * the oldest month of the window and silently miss the two most recent ones,
 * every night, while reporting success. This advances the cursor to the newest
 * LastModifiedDate each window returns and goes again.
 *
 * Two traps, both live-verified 2026-09-05 and both fatal to a naive walk:
 *  - An EMPTY window is NOT the end of the feed. A quiet stretch returns zero
 *    rows even when newer records exist beyond the span (nothing was modified
 *    2026-06-23..2026-09-04, yet a 2026-08-25 cursor returned the September
 *    visits). So an empty window steps the cursor forward by
 *    `emptyWindowStepDays` -- deliberately SHORTER than the span, so nothing can
 *    be skipped -- and the walk only stops once the cursor passes now.
 *  - A window whose newest record sits at the cursor's own second re-presents
 *    that second forever (the cursor is truncated to seconds). Everything at
 *    that second has already been reconciled, so the cursor steps one second
 *    past it instead of stalling.
 *
 * Every window is itself paginated, so each one is a full walkPagedFeed. The
 * hhax.maxCursorWindows guard bounds the loop; hitting it is recorded on the
 * summary because it means the run is INCOMPLETE.
 *
 * @param {Object} params
 * @param {string} params.startCursor - Already formatted ModifiedAfter.
 * @param {string} params.cursorFormat - The Luxon format `startCursor` uses.
 * @param {number} params.emptyWindowStepDays - Advance on an empty window.
 * @param {string} params.element - The record element holding LastModifiedDate.
 * @param {Function} params.fetchPage - ({modifiedAfter, pageNumber}) => page
 * @param {Function} params.processPage - ({records}) => {success}
 * @param {Object} params.summary - Receives the cursor exceptions.
 * @returns {Promise<{success: boolean, error: Object|null}>}
 */
const walkFeedByCursor = async ({
  startCursor,
  cursorFormat,
  emptyWindowStepDays,
  element,
  fetchPage,
  processPage,
  summary,
}) => {
  const maxWindows = config.get('hhax.maxCursorWindows');
  const endCursor = getUTCDaysAgoFormatted({days: 0, format: cursorFormat});
  let cursor = startCursor;

  for (let window = 0; window < maxWindows; window += 1) {
    // Past the present: nothing can have been modified after now.
    if (cursor > endCursor) return {success: true, error: null};

    let newestSeen = null;

    const outcome = await walkPagedFeed({
      fetchPage: async ({pageNumber}) =>
        await fetchPage({modifiedAfter: cursor, pageNumber}),
      processPage: async ({records}) => {
        const newest = readNewestModified({records, element});

        if (newest && (!newestSeen || newest > newestSeen)) newestSeen = newest;

        return await processPage({records});
      },
    });

    if (!outcome.success) return outcome;

    if (!newestSeen) {
      cursor = addToFormattedUTC({
        value: cursor,
        format: cursorFormat,
        duration: {days: emptyWindowStepDays},
      });

      continue;
    }

    const nextCursor = toCursor({value: newestSeen});

    cursor =
      nextCursor > cursor
        ? nextCursor
        : addToFormattedUTC({
            value: cursor,
            format: cursorFormat,
            duration: ONE_SECOND,
          });
  }

  logger.warn('HHAeXchange feed walk hit the cursor window guard', {cursor});
  recordException({
    summary,
    recordId: null,
    type: HHAX_SYNC_EXCEPTION_TYPES.CURSOR_WINDOW_GUARD,
    detail: cursor,
  });

  return {success: true, error: null};
};

/**
 * The state one sync run shares between its resource runners.
 *
 * `nurseIds` is null until the nurse runner has read the GetNurses roster;
 * the caregiver runner refuses to run while it is null, because HHAeXchange
 * lists nurses inside the caregiver change feed and only the roster can tell
 * them apart.
 */
const buildRunContext = () => ({
  nurseIds: null,
});

/**
 * Reduce a run's summaries to a shape safe to store or log.
 *
 * An explicit whitelist, rebuilt field by field rather than copied: exception
 * `detail` is composed partly from HHAeXchange text, and a SOAP fault echoes
 * the request envelope -- which carries AppName/AppSecret/AppKey -- alongside
 * patient identifiers. Counts survive; content does not.
 *
 * @param {Object} params
 * @param {Object} params.summaries - keyed by resource summaryKey.
 * @returns {Object} the same keys, each holding only counters.
 */
const buildSafeRunSummaries = ({summaries}) => {
  const safe = {};

  Object.keys(summaries || {}).forEach((summaryKey) => {
    const summary = summaries[summaryKey] || {};
    const exceptions = summary.exceptions || [];

    const warningCount = exceptions.filter((exception) =>
      HHA_SYNC_WARNING_EXCEPTION_TYPES.includes(exception.type)
    ).length;

    safe[summaryKey] = {
      resource: summary.resource || null,
      succeeded: Boolean(summary.succeeded),
      startedAt: summary.startedAt || null,
      finishedAt: summary.finishedAt || null,
      seen: summary.seen || 0,
      created: summary.created || 0,
      updated: summary.updated || 0,
      skipped: summary.skipped || 0,
      failed: summary.failed || 0,
      countiesResolved: summary.countiesResolved || 0,
      primaryRegionsChanged: summary.primaryRegionsChanged || 0,
      nurseLinksChanged: summary.nurseLinksChanged || 0,
      caseManagerLinksChanged: summary.caseManagerLinksChanged || 0,
      emailsChanged: summary.emailsChanged || 0,

      exceptionCount: exceptions.length,
      blockingCount: exceptions.length - warningCount,
      warningCount,
    };
  });

  return safe;
};

/** Run status from the safe summaries: only blocking exceptions cost "Succeeded". */
const resolveRunStatus = ({summaries}) => {
  const ran = Object.values(summaries || {});
  const succeeded = ran.filter((summary) => summary.succeeded).length;

  if (succeeded === Object.keys(HHAX_SYNC_RESOURCES).length) {
    return ran.some((summary) => summary.blockingCount > 0)
      ? HHA_SYNC_RUN_STATUSES.WITH_EXCEPTIONS.value
      : HHA_SYNC_RUN_STATUSES.SUCCEEDED.value;
  }

  return succeeded > 0
    ? HHA_SYNC_RUN_STATUSES.PARTIAL.value
    : HHA_SYNC_RUN_STATUSES.FAILED.value;
};

/** Per-resource counters rolled into one set of totals for notification copy. */
const buildSyncTotals = ({summaries}) => {
  const totals = {seen: 0, created: 0, updated: 0, skipped: 0};

  Object.values(summaries || {}).forEach((summary) => {
    totals.seen += summary?.seen || 0;
    totals.created += summary?.created || 0;
    totals.updated += summary?.updated || 0;
    totals.skipped += summary?.skipped || 0;
  });

  return totals;
};

module.exports = {
  buildSafeRunSummaries,
  resolveRunStatus,
  markRecordSeen,
  recordChange,
  buildSummary,
  buildSyncTotals,
  buildRunContext,
  recordException,
  walkPagedFeed,
  walkFeedByCursor,
  readNewestModified,
  toCursor,
};
