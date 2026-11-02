const {JOB_NAMES, JOB_SCHEDULER_IDS} = require('../constants/queueConstants');

const {alertsQueue} = require('../lib/bullMQ/queues/alertsQueue');
const logger = require('../middleware/loggerMiddleware');

/**
 * Registers the per-minute `process-escalations` sweep as a BullMQ Job
 * Scheduler (repeatable job managed inside Redis) — no in-process cron.
 *
 * Why a scheduler instead of a CronJob:
 * - The schedule lives in Redis, so it survives app restarts/deploys and
 *   keeps ticking even when a run fails (nothing to re-enqueue manually).
 * - upsert is idempotent: every app instance calls this at boot, but Redis
 *   holds exactly one scheduler and emits exactly one job per minute —
 *   the old per-instance crons each enqueued their own duplicate.
 *
 * The emitted jobs inherit DEFAULT_JOB_OPTIONS (retries/backoff/cleanup)
 * from the queue; the worker sweep itself is CAS-gated, so overlapping or
 * re-run jobs remain safe no-ops.
 */
module.exports.setupEscalationProcessing = async () => {
  try {
    await alertsQueue.upsertJobScheduler(
      JOB_SCHEDULER_IDS.PROCESS_ESCALATIONS,
      {pattern: '* * * * *', tz: 'UTC'},
      {name: JOB_NAMES.PROCESS_ESCALATIONS, data: {}}
    );

    logger.info(
      '[Escalation Scheduler] Per-minute process-escalations job scheduler registered'
    );
  } catch (error) {
    logger.error(
      '[Escalation Scheduler] Failed to register process-escalations job scheduler',
      error
    );
    throw error;
  }
};
