const {Worker} = require('bullmq');
const config = require('config');

const {
  WORKER_NAMES,
  QUEUE_NAMES,
} = require('../../../constants/queueConstants');

const logger = require('../../../middleware/loggerMiddleware');
const EscalationServices = require('../../../services/escalationServices');
const {redisConnection} = require('../../redis');

const bullPrefix = config.get('bullPrefix');

const alertsWorker = new Worker(
  QUEUE_NAMES.FLAG_ESCALATION, // ✅ queue name
  async ({id, name, data}) => {
    switch (name) {
      case WORKER_NAMES.START_FLAG_ESCALATION: {
        // Throw on failure so BullMQ retries per DEFAULT_JOB_OPTIONS.attempts;
        // startEscalation is idempotent (submissionFlagId is @unique), so re-runs are safe.
        const {success, error} = await EscalationServices.startEscalation({
          submissionFlagId: data?.submissionFlagId,
          patientId: data?.patientId,
          organizationId: data?.organizationId,
          performedBy: data?.performedBy || null,
        });

        if (!success) {
          throw error instanceof Error
            ? error
            : new Error(
                error?.message ||
                  `Failed to start escalation for submissionFlag ${data?.submissionFlagId}`
              );
        }

        break;
      }
      case WORKER_NAMES.PROCESS_ESCALATION_EXPIRY: {
        // Precise-expiry advance for one escalation, fired at its exact TTL.
        // Re-checks row state first, so a stale job (row already resolved or
        // advanced) is a safe no-op instead of a wrong transition.
        const {success, skipped, error} =
          await EscalationServices.processEscalationById({
            escalationId: data?.escalationId,
          });

        if (!success) {
          throw error instanceof Error
            ? error
            : new Error(
                error?.message ||
                  `processEscalationById failed for escalation ${data?.escalationId}`
              );
        }

        if (!skipped) {
          logger.info(
            `[EscalationWorker] advanced escalation ${data?.escalationId} at its exact TTL`
          );
        }

        break;
      }
      case WORKER_NAMES.PROCESS_ESCALATIONS: {
        // Periodic sweep — advance every expired escalation. Each row's transition is
        // CAS-gated so concurrent workers and duplicate jobs are safe no-ops.
        const {success, error, processed} =
          await EscalationServices.processEscalations();

        if (!success) {
          throw error instanceof Error
            ? error
            : new Error(error?.message || 'processEscalations failed');
        }

        if (processed > 0) {
          logger.info(
            `[EscalationWorker] advanced ${processed} expired escalation(s)`
          );
        }

        break;
      }
      default:
        throw new Error(`Unknown job type: ${name}`);
    }

    return {success: true}; // ✅ outside the switch
  }, // ✅ closes async fn
  {
    connection: redisConnection, // ✅ 3rd arg to Worker
    prefix: bullPrefix, // ✅ optional prefix for Redis keys
    concurrency: 5, // ✅ process up to 5 jobs in parallel (using fifo order)
  }
);

alertsWorker.on('failed', (job, err) =>
  logger.error(`✗ Job ${job?.id} failed:`, err.message)
);
alertsWorker.on('error', (err) => logger.error('Worker error:', err));

module.exports = {alertsWorker};
