const {createCronJob} = require('./cronJobsUtils');

const logger = require('../middleware/loggerMiddleware');
const {SessionsServices} = require('../services');

/**
 * Registers the nightly purge of expired user sessions (01:00 UTC).
 *
 * Expired rows are already ignored by every session lookup (expiresAt >= now),
 * so this is housekeeping only — it keeps user_sessions from growing forever.
 *
 * Uses the in-process CronJob helper rather than a BullMQ scheduler: the delete
 * is idempotent, so if several replicas fire at once the first removes the rows
 * and the rest delete nothing.
 */
module.exports.setupExpiredSessionsCleanup = async () => {
  const sessionCleanupJob = await createCronJob({
    timer: '0 1 * * *',
    timeZone: 'UTC',
    action: async () => {
      const {success, error, responseObj} =
        await SessionsServices.deleteExpiredSessions();

      // hardDeleteMany never throws — re-raise so createCronJob logs a failure.
      if (!success) {
        throw new Error(error?.message || 'Failed to delete expired sessions');
      }

      logger.info(
        `[Session Cleanup] Deleted ${responseObj?.count ?? 0} expired sessions`
      );
    },
    successMessage: '[Session Cleanup] Expired sessions cleanup completed',
    failureMessage: '[Session Cleanup] Expired sessions cleanup failed',
  });

  sessionCleanupJob.start();
};
