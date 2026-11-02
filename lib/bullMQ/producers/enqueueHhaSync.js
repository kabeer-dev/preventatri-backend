const {hhaSyncQueue} = require('../queues/hhaSyncQueue');

const {JOB_NAMES} = require('../../../constants/queueConstants');

const logger = require('../../../middleware/loggerMiddleware');

/**
 * Unlike enqueueNotificationDelivery, a failure here is returned rather than
 * swallowed: the enqueue IS the work, so the caller must be able to fail the
 * request instead of promising a run that will never happen.
 *
 * jobId is unique per press so a retained failed job cannot swallow a later
 * run; the queued-slot marker does the deduplication instead.
 *
 * @returns {Promise<{success: boolean, jobId?: string, error?: Error}>}
 */
async function enqueueHhaSync({
  runId,
  organizationId,
  requestedByUserId = null,
  trigger,
}) {
  try {
    const job = await hhaSyncQueue.add(
      JOB_NAMES.RUN_HHA_SYNC,
      {runId, organizationId, requestedByUserId, trigger},
      {jobId: runId}
    );

    return {success: true, jobId: job.id};
  } catch (error) {
    logger.error(
      `[enqueueHhaSync] failed to enqueue sync run ${runId}: ${error?.message || error}`
    );

    return {success: false, error};
  }
}

module.exports = {enqueueHhaSync};
