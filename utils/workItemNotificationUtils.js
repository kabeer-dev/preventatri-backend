const logger = require('../middleware/loggerMiddleware');
const NotificationsServices = require('../services/notificationsServices');
const PatientsServices = require('../services/patientsServices');

// The assignee's user id off a row that carries the `assignee` relation.
const getAssigneeUserId = ({item}) =>
  item?.assignee?.user?.id || item?.assignee?.userId || null;

/**
 * Builds a notifier that fans a work item notification out to `recipientIds`.
 * Best-effort and always called after commit: a failure is logged, never
 * thrown. The actor is skipped unless `includeActor` (the creator still wants
 * their own completion record, matching the pre-existing convention).
 */
const createEventNotifier =
  ({documentType, logLabel}) =>
  async ({
    templateKey,
    item,
    recipientIds,
    performedBy = null,
    context = {},
    includeActor = false,
  }) => {
    try {
      const recipients = await PatientsServices.filterRecipientsByPatientAccess(
        {
          recipientIds: (recipientIds || []).filter(
            (recipientId) => includeActor || recipientId !== performedBy
          ),
          patientId: item.patientId,
          organizationId: item.organizationId,
        }
      );

      if (recipients.length === 0) return;

      const patientName = await PatientsServices.resolvePatientName({
        patientId: item.patientId,
      });

      await NotificationsServices.notifyManyFromTemplate({
        templateKey,
        context: Object.assign({patientName}, context),
        recipientIds: recipients,
        organizationId: item.organizationId,
        performedBy,
        documentType,
        documentId: item.id,
        patientId: item.patientId,
      });
    } catch (error) {
      logger.error(
        `[${logLabel}] failed to send ${templateKey} for ${item?.id}: ${error?.message || error}`
      );
    }
  };

module.exports = {createEventNotifier, getAssigneeUserId};
