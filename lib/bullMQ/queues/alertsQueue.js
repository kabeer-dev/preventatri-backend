const {Queue} = require('bullmq');
const config = require('config');

const bullPrefix = config.get('bullPrefix');

const {
  QUEUE_NAMES,
  DEFAULT_JOB_OPTIONS,
} = require('../../../constants/queueConstants');

const {redisConnection} = require('../../redis');

const alertsQueue = new Queue(QUEUE_NAMES.FLAG_ESCALATION, {
  connection: redisConnection,
  prefix: bullPrefix,
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

module.exports = {alertsQueue};
