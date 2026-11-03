const config = require('config');

const {
  DOCUMENT_LINK_CONFIG,
  ALERT_BOX_STYLES,
} = require('../constants/alertConstants');

const {
  ALL_NOTIFICATION_CHANNELS,
  EXTERNAL_NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_PERFORMER_TYPES,
} = require('../constants/notificationConstants');

const {withMembershipDetails} = require('../utils/userUtils');

// Config keys that switch each external channel on or off system-wide.
const EXTERNAL_CHANNEL_TOGGLE_KEYS = {
  [NOTIFICATION_CHANNELS.SMS]: 'smsNotificationsEnabled',
  [NOTIFICATION_CHANNELS.EMAIL]: 'emailNotificationsEnabled',
};

module.exports = class NotificationsHelpers {
  /**
   * Resolve the (performerType, performedBy) pair from a single caller input.
   * Pass a user id for a user-triggered notification, or omit it (null) for a
   * system/automated one. SYSTEM rows always store a null performedBy.
   *
   * @param {object} params
   * @param {string|null} [params.performedBy] - actor user id, or null/omitted for system
   * @returns {{performerType: string, performedBy: string|null}}
   */
  static resolvePerformer({performedBy}) {
    if (performedBy) {
      return {
        performerType: NOTIFICATION_PERFORMER_TYPES.USER.value,
        performedBy,
      };
    }

    return {
      performerType: NOTIFICATION_PERFORMER_TYPES.SYSTEM.value,
      performedBy: null,
    };
  }

  /**
   * The external channels an escalation policy took away: those the caller could
   * have used (`allowedChannels`, every channel by default) but the admin left
   * out of the policy step (`grantedChannels`).
   *
   * @param {object} params
   * @param {string[]} params.grantedChannels - channels the policy step allows
   * @param {string[]} [params.allowedChannels] - the most the caller could use
   * @returns {string[]} blocked EMAIL / SMS channels
   */
  static getPolicyBlockedChannels({
    grantedChannels,
    allowedChannels = ALL_NOTIFICATION_CHANNELS,
  }) {
    return EXTERNAL_NOTIFICATION_CHANNELS.filter(
      (channel) =>
        allowedChannels.includes(channel) && !grantedChannels.includes(channel)
    );
  }

  /**
   * Whether the system-wide toggle (config) for an external channel is on.
   *
   * @param {object} params
   * @param {string} params.channel - EMAIL or SMS
   * @returns {boolean}
   */
  static isExternalChannelEnabled({channel}) {
    const toggleKey = EXTERNAL_CHANNEL_TOGGLE_KEYS[channel];

    return Boolean(toggleKey && config.has(toggleKey) && config.get(toggleKey));
  }

  /**
   * Initial email/SMS delivery statuses for a notification being created, in the
   * order the gates apply: a channel switched off in config is DISABLED (even if
   * the policy also removed it), then one the admin's escalation policy removed
   * is BLOCKED_IN_ESCALATION_POLICY, any other channel the caller didn't ask for
   * is NOT_REQUESTED, and a requested one is PENDING until the delivery worker
   * finalizes it (working hours, contact, send). With no delivery job
   * queued (`willDeliver` false) nothing would ever finalize a PENDING, so a
   * requested channel is NOT_REQUESTED instead.
   *
   * @param {object} params
   * @param {string[]} params.channels - channels the caller allowed
   * @param {string[]} [params.policyBlockedChannels] - channels removed by the policy
   * @param {boolean} [params.willDeliver] - whether a delivery job will be queued
   * @returns {{emailStatus: string, smsStatus: string}}
   */
  static resolveInitialDeliveryStatuses({
    channels,
    policyBlockedChannels = [],
    willDeliver = true,
  }) {
    const statusFor = ({channel}) => {
      const isRelevant =
        channels.includes(channel) || policyBlockedChannels.includes(channel);

      if (
        isRelevant &&
        !NotificationsHelpers.isExternalChannelEnabled({channel})
      ) {
        return NOTIFICATION_DELIVERY_STATUSES.DISABLED;
      }

      if (policyBlockedChannels.includes(channel)) {
        return NOTIFICATION_DELIVERY_STATUSES.BLOCKED_IN_ESCALATION_POLICY;
      }

      return willDeliver && channels.includes(channel)
        ? NOTIFICATION_DELIVERY_STATUSES.PENDING
        : NOTIFICATION_DELIVERY_STATUSES.NOT_REQUESTED;
    };

    return {
      emailStatus: statusFor({channel: NOTIFICATION_CHANNELS.EMAIL}),
      smsStatus: statusFor({channel: NOTIFICATION_CHANNELS.SMS}),
    };
  }

  /**
   * Normalise the frontend routing pair. The DB CHECK requires both columns set
   * or both null, so a half-supplied pair is dropped to null/null. Single source
   * for the "both or neither" rule — reused by every notification write path.
   *
   * @param {object} params
   * @param {string|null} [params.documentType]
   * @param {string|null} [params.documentId]
   * @returns {{documentType: string|null, documentId: string|null}}
   */
  static sanitizeDocumentRouting({documentType, documentId}) {
    const hasDocument = Boolean(documentType && documentId);

    return {
      documentType: hasDocument ? documentType : null,
      documentId: hasDocument ? documentId : null,
    };
  }

  /**
   * Map a persisted notification row (with `performer` hydrated) to the
   * client-facing shape. Single source of truth for the notification payload so
   * the list response and the real-time socket emit are always identical.
   *
   * @param {object} params
   * @param {object} params.notification - persisted row incl. performer
   * @returns {object} client-facing notification object
   */
  static formatForClient({notification}) {
    // The performer's name as they have it in the notification's organization.
    const performer = withMembershipDetails({
      user: notification.performer,
      membership: notification.performer?.userOrganizations?.find(
        (membership) =>
          membership.organizationId === notification.organizationId
      ),
    });

    return {
      id: notification.id,
      title: notification.title,
      description: notification.description,
      type: notification.type,
      documentType: notification.documentType,
      documentId: notification.documentId,
      isRead: notification.isRead,
      readAt: notification.readAt,
      createdAt: notification.createdAt,

      // External delivery outcome per channel (see NOTIFICATION_DELIVERY_STATUSES).
      // The raw provider error stays server-side.
      emailStatus: notification.emailStatus,
      smsStatus: notification.smsStatus,

      // Actor attribution: a {firstName, lastName} object for USER-triggered
      // notifications, null for SYSTEM ones (performedBy is null → no performer).
      performedBy: performer
        ? {firstName: performer.firstName, lastName: performer.lastName}
        : null,
    };
  }

  // Resolve the box style from the notification copy. Yellow is checked first so
  // "yellow flag" doesn't match the generic red-flag rule.
  static resolveBoxStyle = ({title = '', description = ''}) => {
    const text = `${title} ${description}`;

    if (/yellow[-\s]?flag/i.test(text)) return ALERT_BOX_STYLES.yellow;
    if (/flag/i.test(text)) return ALERT_BOX_STYLES.red;

    return ALERT_BOX_STYLES.default;
  };

  // Build the "open this record directly" CTA from the notification's routing
  // pair. Returns null when there's no routing target (e.g. a system notice with
  // no document) or no configured base URL, so the button is simply omitted.
  static buildActionButton = ({documentType, documentId, baseUrl}) => {
    const linkConfig = DOCUMENT_LINK_CONFIG[documentType];

    if (!linkConfig || !documentId || !baseUrl) return null;

    return {
      url: `${baseUrl}${linkConfig.pathPrefix}${documentId}`,
      label: linkConfig.label,
    };
  };
};
