const {modelConstants} = require('../constants');
const AuditServices = require('./auditServices');
const {SYSTEM_ENTITIES} = require('../constants/aclConstants');
const {AUDIT_OPERATIONS} = require('../constants/auditConstants');

const {
  ESCALATION_LEVELS,
  ESCALATION_STATUSES,
} = require('../constants/escalationConstants');
const {TIME_ZONES} = require('../constants/generalConstant');

const {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DELIVERY_AUDIT_ERROR_MAX_LENGTH,
  NOTIFICATION_DELIVERY_AUDIT_LABELS,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_DOCUMENT_TYPES,
} = require('../constants/notificationConstants');
const {AVAILABLE_TIME_ZONES} = require('../constants/organizationsConstants');
const {RED_FLAG_REASONS} = require('../constants/redFlagConstants');
const {PrismaFactory} = require('../factories');
const logger = require('../middleware/loggerMiddleware');
const {formatInZone, normalizeToISO} = require('../utils/dateUtils');

const SYSTEM_ACTOR_LABEL = 'System';

const LEVEL_LABELS = {
  [ESCALATION_LEVELS.PATIENT_PRIMARY_NURSE.value]: 'Patient primary nurse',
  [ESCALATION_LEVELS.REGION_PRIMARY_NURSE.value]: 'Region primary nurse',
  [ESCALATION_LEVELS.PATIENT_SECONDARY_NURSE.value]: 'Patient secondary nurse',
  [ESCALATION_LEVELS.REGION_SECONDARY_NURSE.value]: 'Region secondary nurse',
  [ESCALATION_LEVELS.CASE_MANAGER.value]: 'Case manager',
  [ESCALATION_LEVELS.ADMIN.value]: 'Admin',
};

const getLevelLabel = ({level}) => LEVEL_LABELS[level] || level || null;

const joinName = ({firstName, lastName}) =>
  [firstName, lastName].filter(Boolean).join(' ') || null;

/**
 * Audit trail for a flag's escalation. The escalation runs in workers, not in
 * an HTTP request, so the request logger never sees it: each step is written
 * here, after its transaction commits. Resolving is an HTTP request and is
 * already logged by the request logger. Auditing never changes the
 * escalation's outcome -- every call swallows its own errors.
 *
 * Each snapshot holds only what that step is about (the patient is already the
 * subject of the log), so the "What changed" list stays short.
 */
module.exports = class EscalationAuditServices {
  // currentAssigneeId and event assigneeId are UserOrganization ids.
  static async getAssignee({userOrgId}) {
    if (!userOrgId) return {userId: null, name: null};

    const {doc} = await PrismaFactory.findOne({
      model: modelConstants.MODELS.USER_ORGANIZATION,
      query: {id: userOrgId},
      fieldsInclusion: {
        include: {user: {select: {firstName: true, lastName: true}}},
      },
      options: {bypassExtraQueries: true},
    });

    return {userId: doc?.userId || null, name: joinName(doc?.user || {})};
  }

  static async getUserName({userId}) {
    if (!userId) return null;

    const {doc} = await PrismaFactory.findOne({
      model: modelConstants.MODELS.USER,
      query: {id: userId},
      options: {bypassExtraQueries: true},
    });

    return joinName(doc || {});
  }

  // Statuses worth showing; an ACTIVE one is just noise.
  static getStatusLabel({status}) {
    if (status === ESCALATION_STATUSES.FAILED.value) return status;
    if (status === ESCALATION_STATUSES.ACKNOWLEDGED.value) return 'Accepted';

    return null;
  }

  // Only the fields that have a value.
  static buildSnapshot({
    startedBy,
    flag,
    reason,
    level,
    assignedTo,
    status,
    expiresAt,
    recipient,
    notification,
    email,
    textMessage,
  }) {
    const snapshot = {
      startedBy,
      flagColor: flag,
      reason,
      level: level ? getLevelLabel({level}) : null,
      assignedTo,
      expiresAt: expiresAt ? normalizeToISO({date: expiresAt}) : null,
      status: this.getStatusLabel({status}),
      recipient,
      notification,
      email,
      textMessage,
    };

    return Object.fromEntries(
      Object.entries(snapshot).filter(([, value]) => Boolean(value))
    );
  }

  // The expiry is stored as UTC; the audit detail prints strings as they are,
  // so show it as wall-clock time in the organization's time zone.
  static withLocalExpiry({snapshot, zone}) {
    if (!snapshot?.expiresAt) return snapshot;

    return Object.assign({}, snapshot, {
      expiresAt: formatInZone({date: snapshot.expiresAt, zone}),
    });
  }

  static async getOrganizationZone({organizationId}) {
    const {doc} = await PrismaFactory.findOne({
      model: modelConstants.MODELS.ORGANIZATION,
      query: {id: organizationId},
      options: {bypassExtraQueries: true},
    });

    return (
      AVAILABLE_TIME_ZONES[doc?.timeZone?.toLowerCase()]?.value ||
      TIME_ZONES.utc.value
    );
  }

  static async write({
    action,
    escalation,
    userId = null,
    before = null,
    after = null,
  }) {
    const zone = await this.getOrganizationZone({
      organizationId: escalation.organizationId,
    });

    await AuditServices.logAudit({
      action,
      organizationId: escalation.organizationId,
      userId,
      resourceName: SYSTEM_ENTITIES.escalation.label,
      resourceId: escalation.id,
      before: this.withLocalExpiry({snapshot: before, zone}),
      after: this.withLocalExpiry({snapshot: after, zone}),
      context: {trigger: 'SYSTEM'},
    });
  }

  /**
   * The escalation was created for a flag. The actor is whoever raised the
   * flag: the caregiver for a manual flag, nobody (System) for one a
   * checklist raised.
   */
  static async logStarted({escalation, submissionFlag, performedBy}) {
    try {
      const raisedByName = await this.getUserName({userId: performedBy});

      await this.write({
        action: AUDIT_OPERATIONS.ESCALATION_STARTED.value,
        escalation,
        userId: performedBy || null,
        after: this.buildSnapshot({
          startedBy: raisedByName || SYSTEM_ACTOR_LABEL,
          flag: submissionFlag.flag,
          reason: RED_FLAG_REASONS[submissionFlag.reason]?.label,
          status: escalation.status,
        }),
      });
    } catch (error) {
      logger.error(
        `[EscalationAudit] failed to log start of escalation ${escalation?.id}: ${error?.message || error}`
      );
    }
  }

  /**
   * The flag was handed to an assignee, on start or after an escalation. The
   * system makes the assignment, so there is no actor; assignedTo says who.
   */
  static async logAssigned({escalation, level, assigneeUserOrgId, expiresAt}) {
    try {
      if (!assigneeUserOrgId) return;

      const {name: assignedTo} = await this.getAssignee({
        userOrgId: assigneeUserOrgId,
      });

      await this.write({
        action: AUDIT_OPERATIONS.ESCALATION_ASSIGNED.value,
        escalation,
        after: this.buildSnapshot({assignedTo, level, expiresAt}),
      });
    } catch (error) {
      logger.error(
        `[EscalationAudit] failed to log assignment of escalation ${escalation?.id}: ${error?.message || error}`
      );
    }
  }

  /**
   * The assignee did not respond in time and the flag moved to the next
   * level. The actor is the assignee it moved off.
   */
  static async logEscalated({
    escalation,
    previousEvent,
    nextLevel,
    assigneeUserOrgId,
    newStatus,
  }) {
    try {
      const [previous, next] = await Promise.all([
        this.getAssignee({userOrgId: previousEvent.assigneeId}),
        this.getAssignee({userOrgId: assigneeUserOrgId}),
      ]);

      await this.write({
        action: AUDIT_OPERATIONS.ESCALATED.value,
        escalation,
        userId: previous.userId,
        before: this.buildSnapshot({
          level: escalation.currentLevel,
          assignedTo: previous.name,
        }),
        after: this.buildSnapshot({
          reason: 'No response within the time limit',
          level: nextLevel.value,
          assignedTo: next.name,
          status: newStatus,
        }),
      });
    } catch (error) {
      logger.error(
        `[EscalationAudit] failed to log escalation ${escalation?.id}: ${error?.message || error}`
      );
    }
  }

  /**
   * The assignee accepted the flag, so its deadline is gone and it stays with
   * them. The actor is the assignee who accepted.
   */
  static async logAccepted({escalation, acceptedByUserId, expiresAt}) {
    try {
      const {name: assignedTo} = await this.getAssignee({
        userOrgId: escalation.currentAssigneeId,
      });

      await this.write({
        action: AUDIT_OPERATIONS.ESCALATION_ACCEPTED.value,
        escalation,
        userId: acceptedByUserId,
        before: this.buildSnapshot({
          level: escalation.currentLevel,
          assignedTo,
          expiresAt,
        }),
        after: this.buildSnapshot({
          level: escalation.currentLevel,
          assignedTo,
          status: ESCALATION_STATUSES.ACKNOWLEDGED.value,
        }),
      });
    } catch (error) {
      logger.error(
        `[EscalationAudit] failed to log acceptance of escalation ${escalation?.id}: ${error?.message || error}`
      );
    }
  }

  // A channel's outcome as the activity log reads it; null when not requested.
  static getDeliveryLabel({channel, outcome}) {
    if (!outcome) return null;

    const label = NOTIFICATION_DELIVERY_AUDIT_LABELS[outcome.status];

    if (label && typeof label === 'object') return label[channel] || null;

    if (
      outcome.status === NOTIFICATION_DELIVERY_STATUSES.FAILED &&
      outcome.error
    ) {
      const reason = String(outcome.error).slice(
        0,
        NOTIFICATION_DELIVERY_AUDIT_ERROR_MAX_LENGTH
      );

      return `${label}: ${reason}`;
    }

    return label || outcome.status;
  }

  /**
   * The delivery worker sent, or could not send, an alert notification by
   * email / SMS. Logged on the alert's escalation; the system sends it, so
   * there is no actor. Other notifications (tasks, visits) are not logged.
   */
  static async logNotificationDelivery({
    documentType,
    documentId,
    recipientId,
    title,
    outcomes,
  }) {
    try {
      if (documentType !== NOTIFICATION_DOCUMENT_TYPES.FLAG.value) return;
      if (!documentId || Object.keys(outcomes || {}).length === 0) return;

      const {doc: escalation} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.SUBMISSION_FLAG_ESCALATION,
        query: {submissionFlagId: documentId},
        options: {bypassExtraQueries: true},
      });

      if (!escalation) return;

      const recipient = await this.getUserName({userId: recipientId});

      await this.write({
        action: AUDIT_OPERATIONS.NOTIFICATION_DELIVERY.value,
        escalation,
        after: this.buildSnapshot({
          recipient,
          notification: title,
          email: this.getDeliveryLabel({
            channel: NOTIFICATION_CHANNELS.EMAIL,
            outcome: outcomes[NOTIFICATION_CHANNELS.EMAIL],
          }),
          textMessage: this.getDeliveryLabel({
            channel: NOTIFICATION_CHANNELS.SMS,
            outcome: outcomes[NOTIFICATION_CHANNELS.SMS],
          }),
        }),
      });
    } catch (error) {
      logger.error(
        `[EscalationAudit] failed to log notification delivery for flag ${documentId}: ${error?.message || error}`
      );
    }
  }
};
