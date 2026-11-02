const {Worker} = require('bullmq');
const config = require('config');

const {
  WORKER_NAMES,
  QUEUE_NAMES,
} = require('../../../constants/queueConstants');

const logger = require('../../../middleware/loggerMiddleware');
const HhaSyncReportingServices = require('../../../services/hhaSyncReportingServices');
const HhaSyncServices = require('../../../services/hhaSyncServices');
const {redisConnection} = require('../../redis');

const bullPrefix = config.get('bullPrefix');
const syncLockTtlMs = config.get('hhax.syncLockTtlMs');

/**
 * Runs the HHAeXchange import off the request thread.
 *
 * The job resolves even when the sync failed: attempts is 1, and the failure
 * has already been reported to admins. Only an unknown job name throws.
 */
const hhaSyncWorker = new Worker(
  QUEUE_NAMES.HHA_SYNC,
  async ({name, data}) => {
    switch (name) {
      case WORKER_NAMES.RUN_HHA_SYNC: {
        const {runId, organizationId, requestedByUserId, trigger} = data || {};

        // runSync reports rather than throws, but a defect inside it still
        // could -- and a run that ends without reporting is the silence this
        // feature exists to remove.
        let outcome;

        try {
          outcome = await HhaSyncServices.runSync({
            trigger,
            organizationId,
            runId,
            requestedByUserId,
          });
        } catch (error) {
          outcome = {success: false, summaries: null, error};
        }

        // Not a failure: the cron took the lock in the gap before this job
        // started, so that run is doing the import and its own reporting.
        if (outcome.alreadyRunning) {
          logger.info(
            `[HHA Sync] queued run ${runId} skipped - another run holds the lock`
          );

          return {success: true, skipped: true};
        }

        await HhaSyncReportingServices.reportSyncOutcome({
          runId,
          trigger,

          // The scheduled run resolves its own org, so the passed-in value
          // is null there and would leave the admin lookup unscoped.
          organizationId: outcome.organizationId || organizationId,
          requestedByUserId,
          success: outcome.success,
          summaries: outcome.summaries,
          error: outcome.error,
        });

        return {success: outcome.success};
      }
      default:
        throw new Error(`Unknown job type: ${name}`);
    }
  },
  {
    connection: redisConnection,
    prefix: bullPrefix,
    concurrency: 1,

    // Default lockDuration is 30s, hopeless for a job measured in minutes: one
    // synchronous SOAP parse blocks past the renewal window, the lock lapses,
    // and the job then cannot moveToFinished. Tied to the run's own lock TTL.
    lockDuration: syncLockTtlMs,
    stalledInterval: syncLockTtlMs,

    // Never re-run a stalled job: the default (1) silently repeats an import
    // that may already have written thousands of records. A dead worker leaves
    // a failed job instead, which the lock TTL and the status endpoint recover.
    maxStalledCount: 0,
  }
);

hhaSyncWorker.on('failed', (job, err) =>
  logger.error(`✗ HHAeXchange sync job ${job?.id} failed:`, err.message)
);
hhaSyncWorker.on('error', (err) =>
  logger.error('HHAeXchange sync worker error:', err)
);

module.exports = {hhaSyncWorker};
