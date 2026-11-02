const {Queue} = require('bullmq');
const config = require('config');

const bullPrefix = config.get('bullPrefix');

const {
  QUEUE_NAMES,
  NOTIFICATION_DELIVERY_JOB_OPTIONS,
} = require('../../../constants/queueConstants');

const {redisConnection} = require('../../redis');

// Dedicated queue for delivering persisted notifications to a recipient's
// external channels (SMS + email). The in-app notification is written
// synchronously by NotificationsServices; only the slow, external, failure-prone
// delivery is offloaded here for retry/backoff without blocking the request.
const notificationsQueue = new Queue(QUEUE_NAMES.NOTIFICATION_DELIVERY, {
  connection: redisConnection,
  prefix: bullPrefix,
  defaultJobOptions: NOTIFICATION_DELIVERY_JOB_OPTIONS,
});

module.exports = {notificationsQueue};
