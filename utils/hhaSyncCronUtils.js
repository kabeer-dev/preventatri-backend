const {randomUUID} = require('crypto');

const config = require('config');

const {createCronJob} = require('./cronJobsUtils');

const {
  HHAX_NIGHTLY_CLAIM_KEY_PREFIX,
  HHAX_NIGHTLY_CLAIM_TTL_MS,
  HHAX_SYNC_TRIGGERS,
} = require('../constants/hhaExchangeConstants');
const {redisConnection} = require('../lib/redis');

const logger = require('../middleware/loggerMiddleware');

const {
  HhaCredentialsServices,
  HhaSyncReportingServices,
  HhaSyncServices,
} = require('../services');
const {buildSafeRunSummaries} = require('./hhaExchange/syncRunUtils');

/** Every organization the nightly run covers: the ones with connected credentials. */
const listNightlyOrganizationIds = async () => {
  const {success, organizationIds, error} =
    await HhaCredentialsServices.listConnectedOrganizationIds();

  if (!success) throw error;

  return organizationIds;
};

/**
 * One organization's nightly run. Throws when the run fails, so the caller can
 * count it; a held lock is an expected outcome and is not a failure.
 */
const runNightlySyncForOrganization = async ({organizationId}) => {
  // Every replica walks the whole list, so the organization is claimed for the
  // night first. The run lock alone only stops overlap: a replica that finds an
  // organization busy moves on, and could run it again once it is free.
  const isClaimed = await redisConnection.set(
    `${HHAX_NIGHTLY_CLAIM_KEY_PREFIX}${organizationId}`,
    new Date().toISOString(),
    'PX',
    HHAX_NIGHTLY_CLAIM_TTL_MS,
    'NX'
  );

  if (!isClaimed) {
    logger.info('[HHA Sync] Nightly sync skipped — another replica has it', {
      organizationId,
    });

    return;
  }

  // No queued slot to own (the cron calls runSync directly), but the
  // history row and notification still need something to correlate on.
  const runId = randomUUID();

  const {success, summaries, error, alreadyRunning} =
    await HhaSyncServices.runSync({
      trigger: HHAX_SYNC_TRIGGERS.SCHEDULED.value,
      organizationId,
      runId,
    });

  // A held lock is an expected outcome, not a failure: another replica is
  // already running this exact job, or an admin pressed Sync moments ago.
  // Raising here would log a failed nightly sync for a night that synced
  // perfectly well.
  if (alreadyRunning) {
    logger.info('[HHA Sync] Nightly sync skipped — already running', {
      organizationId,
    });

    return;
  }

  // Counters only: exception records carry HHA data and stay in the DB.
  // Logged BEFORE the throw below, so a partly failed night keeps its numbers.
  logger.info('[HHA Sync] Nightly sync summary', {
    organizationId,
    summaries: buildSafeRunSummaries({summaries}),
  });

  // Reported exactly like a queued run. This is the case that most needs
  // it: nobody is watching in the small hours. No triggering user, so the
  // notification records performerType SYSTEM.
  await HhaSyncReportingServices.reportSyncOutcome({
    runId,
    trigger: HHAX_SYNC_TRIGGERS.SCHEDULED.value,
    organizationId,
    requestedByUserId: null,
    success,
    summaries,
    error,
  });

  // runSync never throws -- it returns the outcome -- so a genuine failure
  // has to be re-raised here or the night would be logged as completed for a
  // run that imported nothing. The context is sanitised by soapClient.
  if (!success) {
    throw new Error(error?.errorMessage || 'HHAeXchange sync failed');
  }
};

/**
 * Registers the nightly HHAeXchange import.
 *
 * Deliberately says nothing about WHICH resources it imports. runSync iterates
 * HHAX_SYNC_RESOURCES, so patients and caregivers both come across on one
 * schedule, and adding a third resource later is a registry entry rather than a
 * second cron job competing for the same lock.
 *
 * Uses the in-process CronJob helper rather than a BullMQ scheduler. A queue
 * would add a dedicated queue, a worker and a Bull Board registration to buy
 * one guarantee — that each organization runs once a night even across
 * replicas. Every replica fires and walks the list; each organization is first
 * claimed with a Redis SET NX (hhax:sync:nightly:<organizationId>), so the
 * others skip it. HhaSyncServices.runSync's per-organization lock is what
 * stops the nightly run colliding with the manual Sync button.
 *
 * There is no enable flag: the nightly run is part of the integration, not an
 * environment toggle. The only way to stop it is to remove this call.
 *
 * The timezone is hhax.syncTimezone (America/New_York by default), NOT UTC.
 * The hour means a wall-clock time for a Pennsylvania home-care agency; running
 * at UTC midnight would fire at 7pm or 8pm local depending on the season.
 *
 * Do NOT move the schedule back to midnight ET: HHAeXchange answers every
 * operation with HTTP 503 in that slot, so the run imported nothing every night
 * until it moved to 4am (PREVENT-561).
 */
module.exports.setupHhaSync = async () => {
  const hhaSyncJob = await createCronJob({
    timer: config.get('hhax.syncCron'),
    timeZone: config.get('hhax.syncTimezone'),
    action: async () => {
      const organizationIds = await listNightlyOrganizationIds();

      // Nothing is connected, so there is nothing to import.
      if (organizationIds.length === 0) {
        logger.info(
          '[HHA Sync] Nightly sync skipped — no organization is connected to HHAeXchange'
        );

        return;
      }

      // One organization after another, so HHAeXchange sees one run at a time,
      // and one organization failing never stops the others.
      const failedOrganizationIds = [];

      for (const organizationId of organizationIds) {
        try {
          await runNightlySyncForOrganization({organizationId});
        } catch (error) {
          failedOrganizationIds.push(organizationId);

          logger.error('[HHA Sync] Nightly sync failed for an organization', {
            organizationId,
            message: error?.message,
          });
        }
      }

      if (failedOrganizationIds.length > 0) {
        throw new Error(
          `HHAeXchange nightly sync failed for ${failedOrganizationIds.length} of ${organizationIds.length} organizations`
        );
      }
    },
    successMessage: '[HHA Sync] Nightly sync completed',
    failureMessage: '[HHA Sync] Nightly sync failed',
  });

  hhaSyncJob.start();
};
