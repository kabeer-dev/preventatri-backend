const {JOB_NAMES, JOB_SCHEDULER_IDS} = require('../constants/queueConstants');
const {WORK_ITEM_CRON} = require('../constants/workItemConstants');

const {followUpTasksQueue} = require('../lib/bullMQ/queues/followUpTasksQueue');
const logger = require('../middleware/loggerMiddleware');

const OVERDUE_SCHEDULE = {
  pattern: WORK_ITEM_CRON.overduePattern,
  tz: WORK_ITEM_CRON.overdueTimeZone,
};

const REMINDER_SCHEDULE = {
  pattern: WORK_ITEM_CRON.reminderPattern,
  tz: WORK_ITEM_CRON.reminderTimeZone,
};

const SCHEDULERS = [
  {
    id: JOB_SCHEDULER_IDS.PROCESS_OVERDUE_FOLLOW_UP_TASKS,
    schedule: OVERDUE_SCHEDULE,
    jobName: JOB_NAMES.PROCESS_OVERDUE_FOLLOW_UP_TASKS,
  },
  {
    id: JOB_SCHEDULER_IDS.PROCESS_FOLLOW_UP_TASK_REMINDERS,
    schedule: REMINDER_SCHEDULE,
    jobName: JOB_NAMES.PROCESS_FOLLOW_UP_TASK_REMINDERS,
  },
  {
    id: JOB_SCHEDULER_IDS.PROCESS_OVERDUE_SUPERVISORY_VISITS,
    schedule: OVERDUE_SCHEDULE,
    jobName: JOB_NAMES.PROCESS_OVERDUE_SUPERVISORY_VISITS,
  },
  {
    id: JOB_SCHEDULER_IDS.PROCESS_SUPERVISORY_VISIT_REMINDERS,
    schedule: REMINDER_SCHEDULE,
    jobName: JOB_NAMES.PROCESS_SUPERVISORY_VISIT_REMINDERS,
  },
];

/**
 * Registers the work-item sweeps (follow-up tasks + supervisory visits) as
 * BullMQ Job Schedulers (Redis-held repeatable jobs), same reasoning as the
 * escalation sweep: one schedule across every replica, survives restarts,
 * retries via the queue's job options.
 */
module.exports.setupWorkItemScheduling = async () => {
  try {
    for (const {id, schedule, jobName} of SCHEDULERS) {
      await followUpTasksQueue.upsertJobScheduler(id, schedule, {
        name: jobName,
        data: {},
      });
    }

    logger.info(
      '[WorkItem Scheduler] overdue + reminder job schedulers registered'
    );
  } catch (error) {
    logger.error(
      '[WorkItem Scheduler] Failed to register work-item job schedulers',
      error
    );
    throw error;
  }
};
