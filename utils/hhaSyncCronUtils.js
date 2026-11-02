const {randomUUID} = require('crypto');

const config = require('config');

const {createCronJob} = require('./cronJobsUtils');

const {HHAX_SYNC_TRIGGERS} = require('../constants/hhaExchangeConstants');

const logger = require('../middleware/loggerMiddleware');
const {HhaSyncReportingServices, HhaSyncServices} = require('../services');
const {getHhaOrganizationId} = require('./hhaExchange/hhaOrganizationUtils');
const {buildSafeRunSummaries} = require('./hhaExchange/syncRunUtils');

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
 * one guarantee — that the job fires once even across replicas — and
 * HhaSyncServices.runSync already provides that guarantee with its Redis
 * SET NX lock: if two containers both fire at midnight, the first acquires the
 * lock and runs, the second sees `alreadyRunning` and exits. The lock is also
 * what stops the nightly run colliding with the manual Sync button, so it is
 * needed either way.
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
      // The integration belongs to one organization. With none named, there is
      // nothing to import into.
      if (!getHhaOrganizationId()) {
        logger.info(
          '[HHA Sync] Nightly sync skipped — HHAX_ORGANIZATION_ID is not set'
        );

        return;
      }

      // No queued slot to own (the cron calls runSync directly), but the
      // history row and notification still need something to correlate on.
      const runId = randomUUID();

      const {success, summaries, error, alreadyRunning, organizationId} =
        await HhaSyncServices.runSync({
          trigger: HHAX_SYNC_TRIGGERS.SCHEDULED.value,
          runId,
        });

      // A held lock is an expected outcome, not a failure: another replica is
      // already running this exact job, or an admin pressed Sync moments ago.
      // Raising here would log a failed nightly sync for a night that synced
      // perfectly well.
      if (alreadyRunning) {
        logger.info('[HHA Sync] Nightly sync skipped — already running');

        return;
      }

      // Counters only: exception records carry HHA data and stay in the DB.
      // Logged BEFORE the throw below, so a partly failed night keeps its numbers.
      logger.info(
        '[HHA Sync] Nightly sync summary',
        buildSafeRunSummaries({summaries})
      );

      // Reported exactly like a queued run. This is the case that most needs
      // it: nobody is watching at midnight. No triggering user, so the
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

      // runSync never throws — it returns the outcome — so a genuine failure
      // has to be re-raised here or createCronJob would log "completed" for a
      // run that imported nothing. The context is sanitised by soapClient.
      if (!success) {
        throw new Error(error?.errorMessage || 'HHAeXchange sync failed');
      }
    },
    successMessage: '[HHA Sync] Nightly sync completed',
    failureMessage: '[HHA Sync] Nightly sync failed',
  });

  hhaSyncJob.start();
};
