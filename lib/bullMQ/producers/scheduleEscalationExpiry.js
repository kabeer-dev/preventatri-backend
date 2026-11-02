const {alertsQueue} = require('../queues/alertsQueue');

const {JOB_NAMES} = require('../../../constants/queueConstants');

const logger = require('../../../middleware/loggerMiddleware');

const {toLuxonUTC, getCurrentTime} = require('../../../utils/dateUtils');

// Schedule a delayed `process-escalation-expiry` job that fires at the exact
// moment the escalation's TTL lapses, instead of waiting for the next
// per-minute sweep tick. Called wherever a row's expiresAt is (re)set —
// escalation start and every level advance.
//
// - A null expiresAt (terminal ADMIN level — no TTL) is a benign no-op.
// - The deterministic jobId dedupes double-scheduling for the same deadline
//   (e.g. a retried advance): BullMQ ignores an add with an existing id.
// - Failures are logged but non-fatal — the per-minute sweep remains the
//   safety net, so a missed precise job only degrades back to sweep latency.
async function scheduleEscalationExpiry({escalationId, expiresAt}) {
  try {
    if (!escalationId || !expiresAt) return {success: true, skipped: true};

    const expiresAtLuxon = toLuxonUTC({date: expiresAt});
    if (!expiresAtLuxon) return {success: true, skipped: true};

    const expiresAtMs = expiresAtLuxon.toMillis();
    const delay = Math.max(0, expiresAtMs - getCurrentTime().getTime());

    const job = await alertsQueue.add(
      JOB_NAMES.PROCESS_ESCALATION_EXPIRY,
      {escalationId},
      {delay, jobId: `escalation-expiry-${escalationId}-${expiresAtMs}`}
    );

    return {success: true, jobId: job.id};
  } catch (error) {
    logger.error(
      `[scheduleEscalationExpiry] failed to enqueue expiry job for escalation ${escalationId}: ${error?.message || error}`
    );

    return {success: false, error};
  }
}

module.exports = {scheduleEscalationExpiry};
