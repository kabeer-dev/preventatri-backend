const {Queue} = require('bullmq');
const config = require('config');

const bullPrefix = config.get('bullPrefix');

const {
  QUEUE_NAMES,
  HHA_SYNC_JOB_OPTIONS,
} = require('../../../constants/queueConstants');

const {redisConnection} = require('../../redis');

// Separate from NOTIFICATION_DELIVERY so the two can have their own
// concurrency and retry policy: a sync run is long, exclusive and not retryable.
const hhaSyncQueue = new Queue(QUEUE_NAMES.HHA_SYNC, {
  connection: redisConnection,
  prefix: bullPrefix,
  defaultJobOptions: HHA_SYNC_JOB_OPTIONS,
});

module.exports = {hhaSyncQueue};
