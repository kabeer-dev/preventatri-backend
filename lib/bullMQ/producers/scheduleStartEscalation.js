const {alertsQueue} = require('../queues/alertsQueue');

const {JOB_NAMES} = require('../../../constants/queueConstants');

const logger = require('../../../middleware/loggerMiddleware');

// Enqueue a `start-flag-escalation` job. The worker re-runs `EscalationServices.startEscalation`
// with retry/backoff from DEFAULT_JOB_OPTIONS, so callers only need to surface enqueue failures.
async function scheduleStartEscalation({
  submissionFlagId,
  patientId,
  organizationId,
  performedBy = null,
}) {
  try {
    const job = await alertsQueue.add(
      JOB_NAMES.START_FLAG_ESCALATION,
      {submissionFlagId, patientId, organizationId, performedBy},
      {priority: 1}
    );

    return {success: true, jobId: job.id};
  } catch (error) {
    logger.error(
      `[scheduleStartEscalation] failed to enqueue start-flag-escalation for submissionFlag ${submissionFlagId}: ${error?.message || error}`
    );

    return {success: false, error};
  }
}

module.exports = {scheduleStartEscalation};
