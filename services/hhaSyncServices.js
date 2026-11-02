/**
 * HHAeXchange sync orchestrator.
 *
 * One-way by design: PreventaTri never writes back to HHAeXchange.
 *
 * This module owns everything that is true of a RUN rather than of a resource:
 * the cross-replica lock, resolving which organization the run belongs to, the
 * lookback window, and the per-resource summaries. The reconciliation rules live
 * in the per-resource services it iterates (see RESOURCE_RUNNERS), each of which
 * exposes the same runResourceSync shape.
 *
 * That indirection is the point. The nightly cron, the controller and the Sync
 * button all say "run the sync"; none of them names a resource. Adding
 * authorizations later is an entry in HHAX_SYNC_RESOURCES plus a runner, with no
 * change here, in the cron, in the route, or in the frontend.
 *
 * Resources are independent: one failing does NOT abort the others. A caregiver
 * outage must not cost the night's patient import, so each resource's outcome is
 * recorded in its own summary and the run reports success only if every resource
 * succeeded.
 *
 * The demographic passes are full rather than incremental because lookbackDays
 * is wide enough to mean "everything"; the visit pass runs on its own, shorter
 * window (see HHAX_SYNC_RESOURCES). Both are affordable because writes are
 * hash-gated: an unchanged roster produces zero field updates.
 */

const {randomUUID} = require('crypto');

const config = require('config');

const HhaCaregiverSyncServices = require('./hhaCaregiverSyncServices');
const HhaCoordinatorSyncServices = require('./hhaCoordinatorSyncServices');
const HhaNurseSyncServices = require('./hhaNurseSyncServices');
const HhaPatientLinkSyncServices = require('./hhaPatientLinkSyncServices');
const HhaPatientSyncServices = require('./hhaPatientSyncServices');
const HhaSyncHistoryServices = require('./hhaSyncHistoryServices');
const HhaVisitSyncServices = require('./hhaVisitSyncServices');

const {
  HHAX_SYNC_TRIGGERS,
  HHAX_SYNC_LOCK_KEY,
  HHAX_SYNC_QUEUED_KEY,
  HHAX_SYNC_QUEUED_TTL_MS,
  HHAX_SYNC_RUN_ERROR_IDS,
  HHAX_SYNC_RESOURCES,
} = require('../constants/hhaExchangeConstants');
const {redisConnection} = require('../lib/redis');
const logger = require('../middleware/loggerMiddleware');

const {
  getCurrentUTCISO,
  getEpochMillis,
  getUTCDaysAgoFormatted,
} = require('../utils/dateUtils');

const {
  getHhaOrganizationId,
} = require('../utils/hhaExchange/hhaOrganizationUtils');

const {
  buildSummary,
  buildRunContext,
} = require('../utils/hhaExchange/syncRunUtils');

/**
 * Compare-and-delete: drop the lock only if this run still owns it. Lua so the
 * check and the delete are a single atomic Redis operation.
 */
const RELEASE_LOCK_IF_OWNED = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

/** Extend the TTL only while this run still owns the lock. */
const RENEW_LOCK_IF_OWNED = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`;

/**
 * Give the queued-slot marker the lock's lifetime. On its own fixed TTL it
 * outlived a dead run's lock and kept the Sync button blocked for minutes.
 */
const alignQueuedSlot = async ({runId, ttlMs}) => {
  if (!runId) return;

  await redisConnection.eval(
    RENEW_LOCK_IF_OWNED,
    1,
    HHAX_SYNC_QUEUED_KEY,
    runId,
    ttlMs
  );
};

/**
 * Keep the lock alive for as long as the run actually takes.
 *
 * The TTL alone was not enough: a visits pass has been observed running over
 * two hours against a one-hour TTL, so the lock expired mid-run and the mutual
 * exclusion quietly stopped holding. The TTL now means "how long after the
 * process dies before the lock frees itself", not "the longest possible run".
 *
 * @returns {{timer: Object, state: {ownsLock: boolean}}} `state` is read by
 *   runResources between resources; see the abort there.
 */
const startLockHeartbeat = ({lockToken, runId, ttlMs}) => {
  const state = {ownsLock: true};

  const timer = setInterval(
    async () => {
      try {
        const renewed = await redisConnection.eval(
          RENEW_LOCK_IF_OWNED,
          1,
          HHAX_SYNC_LOCK_KEY,
          lockToken,
          ttlMs
        );

        if (renewed) await alignQueuedSlot({runId, ttlMs});

        // 0 is definitive rather than transient: the key expired or another run
        // already owns it, so mutual exclusion has lapsed and renewing again
        // would only reclaim a lock this run no longer holds.
        if (!renewed) {
          state.ownsLock = false;

          clearInterval(timer);

          logger.error('HHAeXchange sync lost its run lock', {lockToken});
        }
      } catch (error) {
        // Unlike a 0, an unreachable Redis says nothing about ownership, and
        // abandoning a long import over one blip is worse. The TTL is the
        // backstop if renewals stop landing entirely.
        logger.error('HHAeXchange sync could not renew its lock', {
          error: error?.message || error,
        });
      }
    },
    Math.floor(ttlMs / 3)
  );

  timer.unref?.();

  return {timer, state};
};

/**
 * Resource value -> the service that reconciles it.
 *
 * Kept beside the registry rather than inside it because HHAX_SYNC_RESOURCES is
 * a plain constants module and must not require services — that would be a
 * cycle, since every sync service requires the constants.
 */
const RESOURCE_RUNNERS = {
  [HHAX_SYNC_RESOURCES.COORDINATORS.value]: HhaCoordinatorSyncServices,
  [HHAX_SYNC_RESOURCES.PATIENTS.value]: HhaPatientSyncServices,
  [HHAX_SYNC_RESOURCES.NURSES.value]: HhaNurseSyncServices,
  [HHAX_SYNC_RESOURCES.CAREGIVERS.value]: HhaCaregiverSyncServices,
  [HHAX_SYNC_RESOURCES.VISITS.value]: HhaVisitSyncServices,
};

/**
 * Run every registered resource against one organization, in registry order.
 *
 * Each resource gets its own summary, so the caller can see that patients
 * imported cleanly even on a night the caregiver feed was down.
 *
 * HHAX_SYNC_RESOURCES declaration order is the order the resources RUN in and
 * the order their summaries are reported in; RESOURCE_RUNNERS only selects the
 * runner for each. The ordering rules (nurses before caregivers, every person
 * resource before patients) are documented on HHAX_SYNC_RESOURCES.
 */
const runResources = async ({
  runId,
  trigger,
  organizationId,
  isLockHeld = () => true,
}) => {
  const summaries = {};
  const runContext = buildRunContext();
  let allSucceeded = true;
  let firstError = null;

  for (const resource of Object.values(HHAX_SYNC_RESOURCES)) {
    // Checked between resources rather than inside them: one lock covers the
    // whole pass, so losing it means another run is already importing and this
    // one must stop writing instead of racing it. The resource boundary bounds
    // the overlap without threading a cancellation check through every runner.
    if (!isLockHeld()) {
      allSucceeded = false;

      firstError =
        firstError ||
        Object.assign(new Error('HHAeXchange sync lost its run lock'), {
          errorId: HHAX_SYNC_RUN_ERROR_IDS.LOCK_OWNERSHIP_LOST,
        });

      // Resources after this one get no summary at all, which is the honest
      // record: they never ran, as opposed to running and failing.
      logger.error('HHAeXchange sync aborted: run lock ownership lost', {
        resource: resource.value,
      });

      break;
    }

    const summary = buildSummary({
      trigger,
      resource: resource.value,
      organizationId,
    });

    // Per resource, because the feeds do not agree on either half of this.
    //
    // Format: feed versions disagree on the trailing Z (V4 demographic feeds
    // require it, V3 and the visit feed reject it), so each resource names its own.
    //
    // Window: GetVisitChangesV5 returns FEWER records for an OLDER
    // ModifiedAfter, and the demographic 3650-day window returns none at all
    // -- so visits run on their own, much shorter lookback. Sharing one window
    // would silently import zero visits while reporting success.
    const modifiedAfter = getUTCDaysAgoFormatted({
      days: config.get(resource.lookbackDaysKey),
      format: resource.modifiedAfterFormat,
    });

    // Isolated so a THROWING runner (or a registry entry with no runner) is
    // recorded as that resource's failure instead of rejecting the whole run
    // and losing the summaries of resources that already completed.
    const runner = RESOURCE_RUNNERS[resource.value];

    let outcome;

    try {
      if (!runner) {
        throw new Error(`No runner registered for ${resource.value}`);
      }

      outcome = await runner.runResourceSync({
        organizationId,
        modifiedAfter,
        summary,
        runContext,
      });
    } catch (error) {
      outcome = {success: false, error};
    }

    summary.finishedAt = getCurrentUTCISO();
    summary.succeeded = outcome.success;
    summaries[resource.summaryKey] = summary;

    await HhaSyncHistoryServices.finishResource({
      runId,
      organizationId,
      summary,
    });

    if (!outcome.success) {
      allSucceeded = false;
      firstError = firstError || outcome.error;

      // Logged per resource rather than only at the end, so an unattended run
      // leaves a record of WHICH feed failed.
      logger.error(`HHAeXchange ${resource.label} sync failed mid-feed`, {
        resource: resource.value,
        error: outcome.error,
      });

      continue;
    }

    logger.info(`HHAeXchange ${resource.label} sync completed`, {
      trigger: summary.trigger,
      resource: summary.resource,
      seen: summary.seen,
      created: summary.created,
      updated: summary.updated,
      skipped: summary.skipped,
      exceptions: summary.exceptions.length,
    });
  }

  return {success: allSucceeded, summaries, error: firstError};
};

module.exports = class HhaSyncServices {
  /**
   * Run a full reconciliation of every registered HHAeXchange resource.
   *
   * Identical code path for the nightly scheduler and the manual Sync button —
   * only `trigger` and the organization source differ.
   *
   * @param {Object} params
   * @param {string} params.trigger - An HHAX_SYNC_TRIGGERS value.
   * @param {string} [params.organizationId] - From the caller's JWT on a manual
   *   run. Omitted by the scheduler, which resolves the single admin's org.
   * @param {string} [params.runId] - The run's id: the queued job's, or the
   *   cron's. Releasing the queued slot is compare-and-delete, so the cron's
   *   id never frees a slot it did not claim.
   * @param {string} [params.requestedByUserId] - Who pressed Sync, if anyone.
   * @returns {Promise<{success, summaries, error, alreadyRunning, organizationId}>}
   */
  static async runSync({
    trigger = HHAX_SYNC_TRIGGERS.SCHEDULED.value,
    organizationId = null,
    runId = null,
    requestedByUserId = null,
  }) {
    const historyRunId = runId || randomUUID();

    const lockToken = `${trigger}:${getEpochMillis()}`;

    // Redis SET NX is the concurrency guard, and it holds across replicas — the
    // midnight job and a button press cannot both be running. One lock covers
    // every resource, so a caregiver import cannot start while patients are
    // mid-flight either. The TTL means a process that dies mid-run cannot wedge
    // the lock forever.
    const syncLockTtlMs = config.get('hhax.syncLockTtlMs');

    const lockAcquired = await redisConnection.set(
      HHAX_SYNC_LOCK_KEY,
      lockToken,
      'PX',
      syncLockTtlMs,
      'NX'
    );

    if (!lockAcquired) {
      // No lock means no run, so free the slot instead of blocking the button
      // for its whole TTL. Happens when the cron takes the lock first.
      await HhaSyncServices.releaseQueuedSlot({runId});

      return {
        success: false,
        summaries: null,
        error: null,
        alreadyRunning: true,
      };
    }

    await alignQueuedSlot({runId, ttlMs: syncLockTtlMs});

    // Cleared in the same finally that releases the lock.
    const lockHeartbeat = startLockHeartbeat({
      lockToken,
      runId,
      ttlMs: syncLockTtlMs,
    });

    try {
      // The credentials are one global set, so the sync belongs to the one
      // organization the integration is connected to. With none named, nothing
      // is imported into a guessed organization.
      const resolvedOrganizationId = organizationId || getHhaOrganizationId();

      if (!resolvedOrganizationId) {
        logger.error('HHAeXchange sync has no organization to import into');

        return {
          success: false,
          summaries: null,
          error: null,
          organizationId: null,
        };
      }

      await HhaSyncHistoryServices.startRun({
        runId: historyRunId,
        organizationId: resolvedOrganizationId,
        trigger,
        requestedByUserId,
      });

      // The window is resolved per resource inside runResources: the feeds
      // disagree on both the ModifiedAfter format and how far back is useful.
      let outcome;

      try {
        outcome = await runResources({
          runId: historyRunId,
          trigger,
          organizationId: resolvedOrganizationId,
          isLockHeld: () => lockHeartbeat.state.ownsLock,
        });
      } catch (crash) {
        // Close the row as failed now, or it sits Running until the next run
        // mislabels it Abandoned.
        await HhaSyncHistoryServices.finishRun({
          runId: historyRunId,
          summaries: {},
          error: {errorId: HHAX_SYNC_RUN_ERROR_IDS.RUN_CRASHED},
        });

        throw crash;
      }

      const {success, summaries, error} = outcome;

      // The accept hook stands down while a run holds the lock, so people who
      // accepted an invitation during this run get their patients here.
      if (lockHeartbeat.state.ownsLock) {
        await HhaPatientLinkSyncServices.applyPendingLinks({
          organizationId: resolvedOrganizationId,
        });
      }

      await HhaSyncHistoryServices.finishRun({
        runId: historyRunId,
        summaries,
        error,
      });

      // The RESOLVED org id is returned, not the one that was passed in. The
      // scheduled run supplies none and resolves it from the single admin, so
      // without this the reporter would have nothing to scope the admin lookup to.
      return {
        success,
        summaries,
        error,
        organizationId: resolvedOrganizationId,
      };
    } finally {
      clearInterval(lockHeartbeat.timer);

      // Release only our own lock, and compare-and-delete in ONE Redis round
      // trip. A separate GET then DEL is check-then-act: if the TTL expired
      // mid-run and another run acquired the lock in between, this one would
      // delete the new owner's lock and two syncs could overlap — the exact
      // case the lock exists to prevent.
      await redisConnection.eval(
        RELEASE_LOCK_IF_OWNED,
        1,
        HHAX_SYNC_LOCK_KEY,
        lockToken
      );

      // Held for the whole run, so a crash anywhere frees both guards together.
      await HhaSyncServices.releaseQueuedSlot({runId});
    }
  }

  /** Whether a run currently holds the lock. Used for a clean 409. */
  static async isSyncRunning() {
    const token = await redisConnection.get(HHAX_SYNC_LOCK_KEY);

    return Boolean(token);
  }

  /**
   * Claim the right to enqueue, atomically.
   *
   * The lock is taken inside the WORKER, so between the button press and the
   * job starting isSyncRunning() is still false and a second press would sail
   * through. SET NX makes this a claim rather than a read.
   *
   * @returns {Promise<boolean>} true when this caller may enqueue.
   */
  static async claimQueuedSlot({runId}) {
    const claimed = await redisConnection.set(
      HHAX_SYNC_QUEUED_KEY,
      runId,
      'PX',
      HHAX_SYNC_QUEUED_TTL_MS,
      'NX'
    );

    return Boolean(claimed);
  }

  /** Compare-and-delete so a lapsed-then-reclaimed slot is not freed twice. */
  static async releaseQueuedSlot({runId}) {
    if (!runId) return;

    await redisConnection.eval(
      RELEASE_LOCK_IF_OWNED,
      1,
      HHAX_SYNC_QUEUED_KEY,
      runId
    );
  }

  /**
   * Queued or in flight. Backs the status endpoint so a reload mid-run
   * restores the button instead of offering one that 409s.
   */
  static async isSyncPendingOrRunning() {
    const [lockToken, queuedToken] = await Promise.all([
      redisConnection.get(HHAX_SYNC_LOCK_KEY),
      redisConnection.get(HHAX_SYNC_QUEUED_KEY),
    ]);

    return Boolean(lockToken || queuedToken);
  }
};
