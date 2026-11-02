const {Worker} = require('bullmq');
const config = require('config');

const {
  WORKER_NAMES,
  QUEUE_NAMES,
} = require('../../../constants/queueConstants');

const logger = require('../../../middleware/loggerMiddleware');
const NotificationsServices = require('../../../services/notificationsServices');
const {redisConnection} = require('../../redis');

const bullPrefix = config.get('bullPrefix');

// Processes `deliver-notification` jobs: resolve the recipient's contact
// details once and fan the notification out to the external channels (SMS +
// email). Delivery is best-effort inside the service, so the job resolves
// successfully even when a channel is disabled or a recipient has no phone/email
// on file — a thrown error here would trigger BullMQ retries for a permanent
// condition (e.g. no email address), which we don't want.
const notificationsWorker = new Worker(
  QUEUE_NAMES.NOTIFICATION_DELIVERY,
  async ({name, data}) => {
    switch (name) {
      case WORKER_NAMES.DELIVER_NOTIFICATION: {
        await NotificationsServices.deliverToRecipient({
          notificationId: data?.notificationId,
          recipientId: data?.recipientId,
          organizationId: data?.organizationId,
          title: data?.title,
          description: data?.description,
          documentType: data?.documentType,
          documentId: data?.documentId,
          channels: data?.channels,
          type: data?.type,
        });

        break;
      }
      default:
        throw new Error(`Unknown job type: ${name}`);
    }

    return {success: true};
  },
  {
    connection: redisConnection,
    prefix: bullPrefix,
    concurrency: 5,
  }
);

notificationsWorker.on('failed', (job, err) =>
  logger.error(`✗ Notification delivery job ${job?.id} failed:`, err.message)
);
notificationsWorker.on('error', (err) =>
  logger.error('Notification worker error:', err)
);

module.exports = {notificationsWorker};
