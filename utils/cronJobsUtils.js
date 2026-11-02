const CronJob = require('cron').CronJob;

const logger = require('../middleware/loggerMiddleware');

/**
 * Build a cron job around an async action, with success/failure logging.
 *
 * `timeZone` is optional and passed straight to CronJob's 5th constructor
 * argument. Omitting it keeps the previous behaviour exactly — the schedule is
 * interpreted in the server's local time. Pass it when the schedule means a
 * wall-clock time somewhere specific (e.g. local midnight for an agency),
 * rather than a fixed offset from the server's own clock.
 */
async function createCronJob({
  timer,
  action,
  successMessage,
  failureMessage,
  timeZone,
}) {
  let someJob = new CronJob(
    timer,
    async function () {
      try {
        await action();

        logger.info(`${successMessage} at ${Date()}`);
      } catch (error) {
        logger.error(failureMessage);
      }
    },
    null,
    false,
    timeZone
  );

  return someJob;
}

// SAMPLE USAGE: Previously used to keep Heroku dynos awake.
// Not needed in current setup but kept as a reference for setting up cron jobs.
module.exports.setupCronJobSample = async ({frequencyInMinutes}) => {
  const awakeJob = await createCronJob({
    timer: `*/${frequencyInMinutes} * * * *`,
    action: async () => {
      logger.info('[Sample Cron] Simulating periodic action');
    },
    successMessage: '[Sample Cron] Action executed successfully',
    failureMessage: '[Sample Cron] Failed to execute action',
  });

  awakeJob.start();
};

/**
 * Idempotency TTL Cleanup
 * Removes idempotency records older than 60 seconds
 * Runs every 30 seconds to ensure cleanup
 */
module.exports.setupIdempotencyCleanup = async () => {
  try {
    const {getPrismaClient} = require('./databaseConnectionManager');

    const idempotencyCleanupJob = await createCronJob({
      timer: '*/30 * * * * *', // Every 30 seconds
      action: async () => {
        const sixtySecondsAgo = new Date(Date.now() - 60000);

        const result = await getPrismaClient().idempotency.deleteMany({
          where: {
            createdAt: {
              lt: sixtySecondsAgo,
            },
          },
        });

        if (result.count > 0) {
          logger.info(
            `[Idempotency Cleanup] Deleted ${result.count} expired records`
          );
        }
      },
      successMessage: '[Idempotency Cleanup] TTL cleanup executed successfully',
      failureMessage: '[Idempotency Cleanup] Failed to execute TTL cleanup',
    });

    idempotencyCleanupJob.start();
    logger.info('[Idempotency Cleanup] TTL cleanup job started');

    return idempotencyCleanupJob;
  } catch (error) {
    logger.error(
      '[Idempotency Cleanup] Failed to setup TTL cleanup job',
      error
    );
    throw error;
  }
};

module.exports.createCronJob = createCronJob;
