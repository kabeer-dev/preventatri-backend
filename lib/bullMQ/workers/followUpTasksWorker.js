const {Worker} = require('bullmq');
const config = require('config');

const {
  WORKER_NAMES,
  QUEUE_NAMES,
} = require('../../../constants/queueConstants');

const logger = require('../../../middleware/loggerMiddleware');
const FollowUpTaskSchedulerServices = require('../../../services/followUpTaskSchedulerServices');
const SupervisoryVisitSchedulerServices = require('../../../services/supervisoryVisitSchedulerServices');
const {redisConnection} = require('../../redis');

const bullPrefix = config.get('bullPrefix');

const throwOnFailure = ({success, error, fallbackMessage}) => {
  if (success) return;

  throw error instanceof Error
    ? error
    : new Error(error?.message || fallbackMessage);
};

// Every transition is CAS-gated, so a duplicate or retried job is a safe no-op.
const runOverdue = async ({run, label}) => {
  const result = await run({});

  throwOnFailure(Object.assign({fallbackMessage: `${label} failed`}, result));

  if (result.processed > 0 || result.failed > 0) {
    logger.info(
      `[FollowUpTasksWorker] ${label}: ${result.processed} escalated, ${result.failed} failed`
    );
  }
};

const runReminders = async ({run, label}) => {
  const result = await run({});

  throwOnFailure(Object.assign({fallbackMessage: `${label} failed`}, result));

  if (result.sent > 0 || result.failed > 0) {
    logger.info(
      `[FollowUpTasksWorker] ${label}: ${result.sent} sent, ${result.failed} failed`
    );
  }
};

// One worker for every work-item sweep; the queue name predates the visits.
const followUpTasksWorker = new Worker(
  QUEUE_NAMES.FOLLOW_UP_TASKS,
  async ({name}) => {
    switch (name) {
      case WORKER_NAMES.PROCESS_OVERDUE_FOLLOW_UP_TASKS:
        await runOverdue({
          run: (args) =>
            FollowUpTaskSchedulerServices.processOverdueTasks(args),
          label: 'follow-up overdue sweep',
        });
        break;
      case WORKER_NAMES.PROCESS_FOLLOW_UP_TASK_REMINDERS:
        await runReminders({
          run: (args) => FollowUpTaskSchedulerServices.processReminders(args),
          label: 'follow-up reminder sweep',
        });
        break;
      case WORKER_NAMES.PROCESS_OVERDUE_SUPERVISORY_VISITS:
        await runOverdue({
          run: (args) =>
            SupervisoryVisitSchedulerServices.processOverdueVisits(args),
          label: 'visit overdue sweep',
        });
        break;
      case WORKER_NAMES.PROCESS_SUPERVISORY_VISIT_REMINDERS:
        await runReminders({
          run: (args) =>
            SupervisoryVisitSchedulerServices.processVisitReminders(args),
          label: 'visit reminder sweep',
        });
        break;
      default:
        throw new Error(`Unknown job type: ${name}`);
    }

    return {success: true};
  },
  {
    connection: redisConnection,
    prefix: bullPrefix,
    concurrency: 1,
  }
);

followUpTasksWorker.on('failed', (job, err) =>
  logger.error(`✗ Work-item job ${job?.id} failed:`, err.message)
);
followUpTasksWorker.on('error', (err) =>
  logger.error('Work-item worker error:', err)
);

module.exports = {followUpTasksWorker};
