const {Queue} = require('bullmq');
const config = require('config');

const bullPrefix = config.get('bullPrefix');

const {
  QUEUE_NAMES,
  DEFAULT_JOB_OPTIONS,
} = require('../../../constants/queueConstants');

const {redisConnection} = require('../../redis');

// Scheduled follow-up task sweeps: the nightly overdue escalation and the
// five-minute reminder pass. Both are CAS-gated in the service, so the default
// retry/cleanup options are enough.
const followUpTasksQueue = new Queue(QUEUE_NAMES.FOLLOW_UP_TASKS, {
  connection: redisConnection,
  prefix: bullPrefix,
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

module.exports = {followUpTasksQueue};
