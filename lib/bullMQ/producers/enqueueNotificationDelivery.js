const {notificationsQueue} = require('../queues/notificationsQueue');

const {JOB_NAMES} = require('../../../constants/queueConstants');

const logger = require('../../../middleware/loggerMiddleware');

// Enqueue a `deliver-notification` job for one recipient. The job carries just
// the persisted notification's essentials; the worker resolves the recipient's
// contact details (phone/email) and sends SMS + email per the channel flags.
//
// Best-effort by contract: an enqueue failure is logged and swallowed so it can
// never break the in-app notification (already persisted) or the surrounding
// business flow. The caller does not await delivery.
async function enqueueNotificationDelivery({
  notificationId = null,
  recipientId,
  organizationId,
  title,
  description = null,
  documentType = null,
  documentId = null,
  channels = null,
  type = null,
}) {
  try {
    if (!recipientId) return {success: true, skipped: true};

    const job = await notificationsQueue.add(JOB_NAMES.DELIVER_NOTIFICATION, {
      notificationId,
      recipientId,
      organizationId,
      title,
      description,
      documentType,
      documentId,
      channels,
      type,
    });

    return {success: true, jobId: job.id};
  } catch (error) {
    logger.error(
      `[enqueueNotificationDelivery] failed to enqueue delivery for recipient ${recipientId}: ${error?.message || error}`
    );

    return {success: false, error};
  }
}

module.exports = {enqueueNotificationDelivery};
