const config = require('config');

const {modelConstants} = require('../constants');

const EscalationAuditServices = require('./escalationAuditServices');
const OrganizationsServices = require('./organizationsServices');
const UsersServices = require('./usersServices');

const {
  NOTIFICATION_TEMPLATES,
  NOTIFICATION_CHANNELS,
  ALL_NOTIFICATION_CHANNELS,
  EXTERNAL_NOTIFICATION_CHANNELS,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_PRIORITY_INDICATORS,
} = require('../constants/notificationConstants');

const {
  SOCKET_EVENTS,
  SOCKET_ROOM_PREFIXES,
} = require('../constants/socketsEventConstants');
const {SYSTEM_ROLES} = require('../constants/usersConstants');

const {PrismaFactory} = require('../factories');
const NotificationsHelpers = require('../helpers/notificationsHelpers');

const {
  enqueueNotificationDelivery,
} = require('../lib/bullMQ/producers/enqueueNotificationDelivery');

const logger = require('../middleware/loggerMiddleware');

const {
  buildCaregiverPatientAccessClause,
} = require('../utils/checklistAssignmentUtils');

const {buildDateRangeClause, getCurrentTime} = require('../utils/dateUtils');
const {sendAlert} = require('../utils/email/processes');
const {getFrontendBaseUrl} = require('../utils/general');

const {
  isWithinOrganizationWorkingHours,
} = require('../utils/organizationsUtils');
const sendSms = require('../utils/phone/send');
const {sendPrivateSocketMessage} = require('../utils/socketUtils');

const {getFullName, withOrganizationDetails} = require('../utils/userUtils');

// Hydrate the actor on notification reads/writes so responses (and the socket
// payload) can expose performedBy as {firstName, lastName}; null for SYSTEM
// notifications where performedBy is null. The name comes from the performer's
// membership of the notification's organization (picked in formatForClient).
const PERFORMER_SELECT = {
  select: {
    firstName: true,
    lastName: true,
    userOrganizations: {
      where: {isDeleted: null},
      select: {organizationId: true, firstName: true, lastName: true},
    },
  },
};

const NOTIFICATION_PERFORMER_INCLUSION = {
  include: {performer: PERFORMER_SELECT},
};

// Render a template's title/description from context. Titles may be static
// strings or context functions (flag-lifecycle templates interpolate the flag
// severity). Callers must treat a throw here as a failed-but-swallowed render
// so a bad template/context can never break the surrounding business flow.
//
// `externalDescription` is a second copy of the body with the patient's name
// stripped, for the external channels (SMS + email) which must never carry
// patient PII. The templates fall back to generic "a patient" phrasing when no
// name is supplied, so re-rendering with patientName cleared yields the safe
// copy. The in-app notification keeps the full `description`.
const renderTemplate = ({template, context}) => ({
  type:
    typeof template.type === 'function'
      ? template.type(context)
      : template.type || NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
  title:
    typeof template.title === 'function'
      ? template.title(context)
      : template.title,
  description: template.description(context),
  externalDescription: template.description(
    Object.assign({}, context, {patientName: null})
  ),
});

// SMS copy: greets the recipient by name and role, then the notification
// title + description, ending with the dashboard link. The name falls back to
// just "Hi," when unknown.
const buildSmsBody = ({recipient, title, description}) => {
  const name = getFullName({user: recipient});
  const roleLabel = SYSTEM_ROLES[recipient?.role]?.label;

  const greeting = [
    'Hi',
    name && ` ${name}`,
    roleLabel && ` (${roleLabel})`,
    ',',
  ]
    .filter(Boolean)
    .join('');

  const message = description ? `${title}. ${description}` : title;
  const dashboardUrl = getFrontendBaseUrl();

  return `${greeting}\n\n${message}${dashboardUrl ? `\n\n${dashboardUrl}` : ''}`;
};

module.exports = class NotificationsServices {
  /**
   * Feed filter for one recipient: a caregiver only sees notices that are not
   * about a patient, or whose patient they can still open. Null for staff.
   * `role` is looked up when the caller has no token (socket emit).
   *
   * @returns {Promise<object|null>}
   */
  static async buildFeedVisibilityClause({recipientId, organizationId, role}) {
    let recipientRole = role;

    if (!recipientRole) {
      const {doc} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.USER_ORGANIZATION,
        query: {userId: recipientId, organizationId},
        options: {bypassExtraQueries: true},
      });

      recipientRole = doc?.role;
    }

    if (recipientRole !== SYSTEM_ROLES.caregiver.value) return null;

    return {
      OR: [
        {documentType: null},
        {patient: buildCaregiverPatientAccessClause({userId: recipientId})},
      ],
    };
  }

  // Adds the feed filter to a notification query (no-op for staff).
  static withFeedVisibility({query, visibility}) {
    if (!visibility) return query;

    return Object.assign({}, query, {
      AND: (query.AND || []).concat(visibility),
    });
  }

  /**
   * Emit a real-time "new notification" socket event to the recipient's private
   * room (`user:<recipientId>`). Best-effort and fire-and-forget — a socket (or
   * count) failure must never break the notification write. Takes the persisted
   * notification row (with `performer` hydrated) and emits it through the shared
   * client formatter, so the toast payload is identical to the list response and
   * always reflects the stored routing pair. The payload also carries the
   * recipient's current total unread count for the unread badge.
   *
   * @param {object} params
   * @param {object} params.notification - persisted notification row incl. performer
   */
  static async notifyRecipientViaSocket({notification}) {
    const recipientId = notification?.recipientId;
    if (!recipientId) return;

    try {
      const visibility = await NotificationsServices.buildFeedVisibilityClause({
        recipientId,
        organizationId: notification.organizationId,
      });

      const unreadResult = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.NOTIFICATION,
        query: NotificationsServices.withFeedVisibility({
          query: {
            recipientId,
            organizationId: notification.organizationId,
            isRead: false,
          },
          visibility,
        }),
        options: {bypassExtraQueries: true},
      });

      sendPrivateSocketMessage({
        room: `${SOCKET_ROOM_PREFIXES.USER.value}${recipientId}`,
        event: SOCKET_EVENTS.NOTIFICATION_NEW.value,
        data: {
          // The room is per user, so a person in several organizations gets
          // every organization's pushes; the client keeps only its own.
          organizationId: notification.organizationId,
          totalUnreadCount: unreadResult.success ? unreadResult.count : 0,
          notification: NotificationsHelpers.formatForClient({notification}),
        },
      });
    } catch (error) {
      logger.error(
        `[Notification] failed to emit socket for recipient ${recipientId}: ${error?.message || error}`
      );
    }
  }

  /**
   * Persist the final delivery status (and failure reason) of the external
   * channels on a notification row. Best-effort: a failed write is logged and
   * swallowed so it can never fail the delivery job. `updates` maps a channel
   * (EMAIL / SMS) to `{status, error?}`; unlisted channels are left untouched.
   *
   * @param {object} params
   * @param {string} params.notificationId
   * @param {object} params.updates
   */
  static async saveDeliveryStatuses({notificationId, updates}) {
    if (!notificationId) return;

    const columnsByChannel = {
      [NOTIFICATION_CHANNELS.EMAIL]: {
        status: 'emailStatus',
        error: 'emailError',
      },
      [NOTIFICATION_CHANNELS.SMS]: {status: 'smsStatus', error: 'smsError'},
    };

    const data = {};

    Object.entries(updates).forEach(([channel, {status, error}]) => {
      const columns = columnsByChannel[channel];

      data[columns.status] = status;
      data[columns.error] = error ? String(error).slice(0, 1000) : null;
    });

    if (Object.keys(data).length === 0) return;

    try {
      await PrismaFactory.updateOne({
        model: modelConstants.MODELS.NOTIFICATION,
        query: {id: notificationId},
        data,
        options: {bypassExtraQueries: true},
      });
    } catch (error) {
      logger.error(
        `[Notification] failed to save delivery status for notification ${notificationId}: ${error?.message || error}`
      );
    }
  }

  /**
   * Deliver an already-persisted notification to the recipient's external
   * channels (SMS + email). Invoked by the notification-delivery BullMQ worker,
   * NOT inline in the request — the in-app row + socket are handled synchronously
   * by createNotification; only this slow, external, failure-prone step is queued
   * (for retry/backoff) so it never blocks the caller.
   *
   * Resolves the recipient's contact details once, then fans out to each
   * requested channel. Every channel is best-effort and independently guarded,
   * and its outcome is saved on the notification row (`emailStatus`/`smsStatus`):
   * - DISABLED: the system-wide SMS/email toggle is off.
   * - NOT_IN_WORKING_HOURS: non-critical and outside the org's working hours.
   * - NO_CONTACT: the user has no phone number / email on file.
   * - SENT / FAILED: the send was attempted (a failure is logged and swallowed
   *   so it can't fail the job, trigger pointless retries or affect the other
   *   channel).
   * Channels the caller didn't request, or the escalation policy blocked, were
   * already set when the row was created and aren't touched here.
   *
   * @param {object} params
   * @param {string|null} [params.notificationId] - row whose statuses are saved;
   *   omitted by jobs queued before statuses existed (delivery still happens)
   * @param {string} params.recipientId
   * @param {string|null} [params.organizationId] - used to gate SMS/email to the
   *   org's working hours; required unless `type` is CRITICAL
   * @param {string} params.title
   * @param {string|null} [params.description]
   * @param {string|null} [params.documentType] - routing type for the email deep link
   * @param {string|null} [params.documentId] - routing id for the email deep link
   * @param {string} [params.type] - priority (see NOTIFICATION_PRIORITY_INDICATORS);
   *   CRITICAL notifications bypass the working-hours gate below
   */
  static async deliverToRecipient({
    notificationId = null,
    recipientId,
    organizationId = null,
    title,
    description = null,
    documentType = null,
    documentId = null,
    channels = ALL_NOTIFICATION_CHANNELS,
    type = NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
  }) {
    if (!recipientId || !title) return;

    // A channel fires only when the caller allowed it AND the system-wide toggle
    // is on. The per-notification `channels` restricts (never widens) delivery.
    const allowedChannels = channels || ALL_NOTIFICATION_CHANNELS;

    // Outcome per requested external channel, saved once at the end.
    const outcomes = {};

    // Requested channels that still have no outcome (i.e. still need sending).
    // Only `record` removes a channel from here, so it stays in sync with
    // `outcomes`.
    let remainingChannels = EXTERNAL_NOTIFICATION_CHANNELS.filter((channel) =>
      allowedChannels.includes(channel)
    );

    // Reassigns `remainingChannels`, so loops started before a record keep
    // iterating their own snapshot of the previous array.
    const record = ({channel, outcome}) => {
      outcomes[channel] = outcome;
      remainingChannels = remainingChannels.filter(
        (remainingChannel) => remainingChannel !== channel
      );
    };

    const saveOutcomes = async () => {
      await NotificationsServices.saveDeliveryStatuses({
        notificationId,
        updates: outcomes,
      });

      await EscalationAuditServices.logNotificationDelivery({
        documentType,
        documentId,
        recipientId,
        title,
        outcomes,
      });
    };

    remainingChannels.forEach((channel) => {
      if (!NotificationsHelpers.isExternalChannelEnabled({channel})) {
        record({
          channel,
          outcome: {status: NOTIFICATION_DELIVERY_STATUSES.DISABLED},
        });
      }
    });

    try {
      // CRITICAL notifications always go out; everything else is confined to the
      // org's working hours so people aren't paged for routine updates off-hours.
      if (
        remainingChannels.length > 0 &&
        type !== NOTIFICATION_PRIORITY_INDICATORS.CRITICAL.value
      ) {
        const {doc: organization} =
          await OrganizationsServices.getOrganizationById({id: organizationId});

        const withinWorkingHours = isWithinOrganizationWorkingHours({
          workingHours: organization?.workingHours,
          timeZone: organization?.timeZone,
        });

        if (!withinWorkingHours) {
          remainingChannels.forEach((channel) => {
            record({
              channel,
              outcome: {
                status: NOTIFICATION_DELIVERY_STATUSES.NOT_IN_WORKING_HOURS,
              },
            });
          });
        }
      }

      if (remainingChannels.length > 0) {
        // The recipient's contact info lives on the users table, not on the
        // notification row. bypassExtraQueries so this works from the background
        // worker with no ACL request context.
        const {success, user: account} = await UsersServices.getUserById({
          id: recipientId,
          options: {bypassExtraQueries: true},
        });

        // Phone and name as the recipient has them in this organization.
        const recipient = await withOrganizationDetails({
          user: account,
          organizationId,
        });

        const contacts = {
          [NOTIFICATION_CHANNELS.SMS]: success && recipient?.phoneNo,
          [NOTIFICATION_CHANNELS.EMAIL]: success && recipient?.email,
        };

        remainingChannels.forEach((channel) => {
          if (!contacts[channel]) {
            record({
              channel,
              outcome: {status: NOTIFICATION_DELIVERY_STATUSES.NO_CONTACT},
            });
          }
        });

        const sends = {
          [NOTIFICATION_CHANNELS.SMS]: () =>
            sendSms({
              to: recipient.phoneNo,
              from: config.get('twilioPhoneNumber'),
              body: buildSmsBody({recipient, title, description}),
            }),
          [NOTIFICATION_CHANNELS.EMAIL]: () =>
            sendAlert({
              user: recipient,
              title,
              description,
              documentType,
              documentId,
            }),
        };

        for (const channel of remainingChannels) {
          try {
            await sends[channel]();

            record({
              channel,
              outcome: {status: NOTIFICATION_DELIVERY_STATUSES.SENT},
            });
          } catch (error) {
            logger.error(
              `[Notification] failed to send ${channel} for recipient ${recipientId}: ${error?.message || error}`
            );

            record({
              channel,
              outcome: {
                status: NOTIFICATION_DELIVERY_STATUSES.FAILED,
                error: error?.message || String(error),
              },
            });
          }
        }
      }
    } catch (error) {
      // Unexpected lookup failure: record it so no channel is left PENDING, then
      // rethrow so BullMQ retries the job (nothing has been sent yet).
      remainingChannels.forEach((channel) => {
        record({
          channel,
          outcome: {
            status: NOTIFICATION_DELIVERY_STATUSES.FAILED,
            error: error?.message || String(error),
          },
        });
      });

      await saveOutcomes();

      throw error;
    }

    await saveOutcomes();
  }

  /**
   * Create a single in-app notification for one recipient.
   *
   * Generic + reusable: any controller/service supplies the recipient
   * (recipientId), the organization, and the already-rendered title/description.
   * Pass the actor's `performedBy` user id for a user-triggered notification, or
   * omit it for a system/automated event (performerType=SYSTEM, performedBy=null).
   *
   * organizationId is provided explicitly and bypassExtraQueries is set, so this
   * works identically inside a request AND from background workers (e.g. the
   * escalation cron) where there is no ACL request context to scope on.
   *
   * Pass `tx` to enlist the write in a surrounding transaction.
   *
   * @returns {Promise<{success, doc, error}>}
   */
  static async createNotification({
    recipientId,
    organizationId,
    title,
    description = null,
    externalDescription = null,
    type = NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
    performedBy = null,
    documentType = null,
    documentId = null,
    patientId = null,
    channels = ALL_NOTIFICATION_CHANNELS,
    policyBlockedChannels = [],
    tx,
  }) {
    try {
      // Default params don't cover an explicit `null`, so normalize here (as
      // deliverToRecipient/createNotifications do) — otherwise a null `channels`
      // would throw on `.includes` AFTER the row is persisted, returning failure
      // and risking a duplicate on caller retry.
      const allowedChannels = channels || ALL_NOTIFICATION_CHANNELS;

      const performer = NotificationsHelpers.resolvePerformer({performedBy});

      const routing = NotificationsHelpers.sanitizeDocumentRouting({
        documentType,
        documentId,
      });

      const initialStatuses =
        NotificationsHelpers.resolveInitialDeliveryStatuses({
          channels: allowedChannels,
          policyBlockedChannels,
          willDeliver: !tx,
        });

      const result = await PrismaFactory.create({
        model: modelConstants.MODELS.NOTIFICATION,
        data: {
          recipientId,
          organizationId,
          title,
          description,
          type,
          performerType: performer.performerType,
          performedBy: performer.performedBy,
          documentType: routing.documentType,
          documentId: routing.documentId,
          patientId,

          // Inside a caller's transaction no delivery job is queued, so a
          // requested channel must not be left PENDING forever.
          emailStatus: initialStatuses.emailStatus,
          smsStatus: initialStatuses.smsStatus,
        },

        // Hydrate the actor so the socket payload can expose the full
        // notification (with performedBy) without a follow-up query.
        fieldsInclusion: NOTIFICATION_PERFORMER_INCLUSION,
        options: {bypassExtraQueries: true},
        tx,
      });

      // Skip the socket emit while enlisted in a caller's transaction: the row
      // isn't committed yet, so toasting now could surface a notification that
      // later rolls back (and the unread-count query would run outside the tx).
      // The transaction owner is responsible for notifying post-commit. Emit the
      // persisted row so the payload is DB-authoritative (routing pair included).
      if (result.success && !tx) {
        // The in-app row is always persisted (it carries the routing pair); the
        // socket toast is the IN_APP channel, so only emit it when IN_APP is on.
        if (allowedChannels.includes(NOTIFICATION_CHANNELS.IN_APP)) {
          NotificationsServices.notifyRecipientViaSocket({
            notification: result.doc,
          });
        }

        // Offload the external channels (SMS + email) to the delivery queue so
        // they retry/backoff without blocking this write. Skip the enqueue
        // entirely when neither external channel is requested. The delivery
        // worker re-checks `channels` before sending each channel.
        const wantsExternal =
          allowedChannels.includes(NOTIFICATION_CHANNELS.EMAIL) ||
          allowedChannels.includes(NOTIFICATION_CHANNELS.SMS);

        if (wantsExternal) {
          enqueueNotificationDelivery({
            notificationId: result.doc.id,
            recipientId: result.doc.recipientId,
            organizationId: result.doc.organizationId,
            title: result.doc.title,
            type: result.doc.type,

            // SMS + email get the patient-name-free copy; fall back to the stored
            // description when no external override was supplied (non-template
            // callers pass already-safe copy).
            description: externalDescription || result.doc.description,
            documentType: result.doc.documentType,
            documentId: result.doc.documentId,
            channels: allowedChannels,
          });
        }
      }

      return result;
    } catch (error) {
      logger.error(
        `[Notification] failed to create for recipient ${recipientId}: ${error?.message || error}`
      );

      return {success: false, doc: null, error};
    }
  }

  /**
   * Create a notification from a centralized template (NOTIFICATION_TEMPLATES).
   *
   * Preferred entry point for call sites: keeps the copy (title/description) out
   * of controllers and consistent across the app. `templateKey` selects the
   * template; `context` is passed to the template's description builder for any
   * interpolated values (e.g. patient name).
   *
   * @returns {Promise<{success, doc, error}>}
   */
  static async notifyFromTemplate({
    templateKey,
    context = {},
    recipientId,
    organizationId,
    performedBy = null,
    documentType = null,
    documentId = null,
    patientId = null,
    channels = ALL_NOTIFICATION_CHANNELS,
    policyBlockedChannels = [],
    tx,
  }) {
    const template = NOTIFICATION_TEMPLATES[templateKey];

    if (!template) {
      const error = new Error(`Unknown notification template: ${templateKey}`);
      logger.error(`[Notification] ${error.message}`);

      return {success: false, doc: null, error};
    }

    // Render inside the best-effort boundary: a throwing template/context must
    // fail the notification, never the escalation/resolution flow that sent it.
    let rendered;

    try {
      rendered = renderTemplate({template, context});
    } catch (error) {
      logger.error(
        `[Notification] failed to render template ${templateKey}: ${error?.message || error}`
      );

      return {success: false, doc: null, error};
    }

    return NotificationsServices.createNotification({
      recipientId,
      organizationId,
      title: rendered.title,
      description: rendered.description,
      externalDescription: rendered.externalDescription,
      type: rendered.type,
      performedBy,
      documentType,
      documentId,
      patientId,
      channels,
      policyBlockedChannels,
      tx,
    });
  }

  /**
   * Fan-out helper: create one notification per recipient in a single
   * round-trip. Intended for events that notify several people at once (e.g. an
   * escalation notifies the new assignee AND the overseeing case manager).
   *
   * `notifications` is an array of
   * {recipientId, organizationId, title, description?, performedBy?}.
   *
   * Uses createManyAndReturn so the created rows (with performer hydrated) are
   * available to emit full notification objects over the socket.
   *
   * @returns {Promise<{success, count, error}>}
   */
  static async createNotifications({notifications, tx}) {
    try {
      const rows = (notifications || []).map((notification) => {
        const performer = NotificationsHelpers.resolvePerformer({
          performedBy: notification.performedBy,
        });

        const routing = NotificationsHelpers.sanitizeDocumentRouting({
          documentType: notification.documentType,
          documentId: notification.documentId,
        });

        // No delivery job is queued inside a caller's transaction, so don't
        // leave a requested channel PENDING forever.
        const initialStatuses =
          NotificationsHelpers.resolveInitialDeliveryStatuses({
            channels: notification.channels || ALL_NOTIFICATION_CHANNELS,
            policyBlockedChannels: notification.policyBlockedChannels,
            willDeliver: !tx,
          });

        return {
          recipientId: notification.recipientId,
          organizationId: notification.organizationId,
          title: notification.title,
          description: notification.description || null,
          type: notification.type || NOTIFICATION_PRIORITY_INDICATORS.LOW.value,
          performerType: performer.performerType,
          performedBy: performer.performedBy,
          documentType: routing.documentType,
          documentId: routing.documentId,
          patientId: notification.patientId || null,
          emailStatus: initialStatuses.emailStatus,
          smsStatus: initialStatuses.smsStatus,
        };
      });

      if (rows.length === 0) {
        return {success: true, count: 0};
      }

      // createManyAndReturn (not createMany) so we get the created rows back —
      // with their performer hydrated — to emit full notification objects over
      // the socket without a follow-up query per recipient.
      const {success, error, docs} = await PrismaFactory.createManyAndReturn({
        model: modelConstants.MODELS.NOTIFICATION,
        data: rows,
        fieldsInclusion: NOTIFICATION_PERFORMER_INCLUSION,
        options: {bypassExtraQueries: true},
        tx,
      });

      // The name-free external copy isn't a DB column, so it isn't on the
      // returned `docs`. Map it back by recipientId (recipients are unique per
      // batch) to route the PII-free body to SMS + email.
      const externalDescriptionByRecipient = new Map(
        (notifications || []).map((notification) => [
          notification.recipientId,
          notification.externalDescription,
        ])
      );

      // Same for the requested channels — not a DB column, so map it back by
      // recipientId to gate the socket + external delivery per recipient.
      const channelsByRecipient = new Map(
        (notifications || []).map((notification) => [
          notification.recipientId,
          notification.channels || ALL_NOTIFICATION_CHANNELS,
        ])
      );

      // See createNotification: don't emit sockets from inside a caller's
      // transaction — the rows may still roll back. The tx owner notifies
      // post-commit. Emit the persisted rows (performer hydrated) so each socket
      // payload matches the stored notification exactly.
      if (success && !tx) {
        (docs || []).forEach((notification) => {
          const channels =
            channelsByRecipient.get(notification.recipientId) ||
            ALL_NOTIFICATION_CHANNELS;

          // Socket toast is the IN_APP channel — emit only when it's requested.
          if (channels.includes(NOTIFICATION_CHANNELS.IN_APP)) {
            NotificationsServices.notifyRecipientViaSocket({notification});
          }

          // Queue the external channels (SMS + email) per recipient, skipping the
          // enqueue when neither is requested.
          const wantsExternal =
            channels.includes(NOTIFICATION_CHANNELS.EMAIL) ||
            channels.includes(NOTIFICATION_CHANNELS.SMS);

          if (wantsExternal) {
            enqueueNotificationDelivery({
              notificationId: notification.id,
              recipientId: notification.recipientId,
              organizationId: notification.organizationId,
              title: notification.title,
              type: notification.type,

              // SMS + email get the patient-name-free copy (see createNotification).
              description:
                externalDescriptionByRecipient.get(notification.recipientId) ||
                notification.description,
              documentType: notification.documentType,
              documentId: notification.documentId,
              channels,
            });
          }
        });
      }

      return {success, error, count: docs?.length || 0};
    } catch (error) {
      logger.error(
        `[Notification] failed to create batch: ${error?.message || error}`
      );

      return {success: false, count: 0, error};
    }
  }

  /**
   * Fan-out from a centralized template: send the same templated notification to
   * many recipients in a single round-trip. The template's title/description
   * (built once from `context`) is shared across all recipients.
   *
   * `recipientIds` is an array of user ids; duplicates and falsy values are
   * dropped so a user is never notified twice for the same event.
   *
   * `channels` applies to every recipient; `channelsByRecipientId`
   * ({[userId]: channels[]}) overrides it per recipient. Those overrides come
   * from escalation policy steps, so an external channel (email/SMS) missing from
   * a recipient's override was removed by the admin and is stored as
   * BLOCKED_IN_ESCALATION_POLICY.
   *
   * @returns {Promise<{success, count, error}>}
   */
  static async notifyManyFromTemplate({
    templateKey,
    context = {},
    recipientIds,
    organizationId,
    performedBy = null,
    documentType = null,
    documentId = null,
    patientId = null,
    channels = ALL_NOTIFICATION_CHANNELS,
    channelsByRecipientId = {},
    tx,
  }) {
    const template = NOTIFICATION_TEMPLATES[templateKey];

    if (!template) {
      const error = new Error(`Unknown notification template: ${templateKey}`);
      logger.error(`[Notification] ${error.message}`);

      return {success: false, count: 0, error};
    }

    const uniqueRecipientIds = Array.from(
      new Set((recipientIds || []).filter(Boolean))
    );

    // Render inside the best-effort boundary: a throwing template/context must
    // fail the fan-out, never the flow that triggered it.
    let rendered;

    try {
      rendered = renderTemplate({template, context});
    } catch (error) {
      logger.error(
        `[Notification] failed to render template ${templateKey}: ${error?.message || error}`
      );

      return {success: false, count: 0, error};
    }

    const notifications = uniqueRecipientIds.map((recipientId) => ({
      recipientId,
      organizationId,
      title: rendered.title,
      description: rendered.description,
      externalDescription: rendered.externalDescription,
      type: rendered.type,
      documentType,
      documentId,
      patientId,
      performedBy,

      // A recipient-specific channel list wins over the shared `channels`.
      channels: channelsByRecipientId[recipientId] || channels,
      policyBlockedChannels: channelsByRecipientId[recipientId]
        ? NotificationsHelpers.getPolicyBlockedChannels({
            grantedChannels: channelsByRecipientId[recipientId],
          })
        : [],
    }));

    return NotificationsServices.createNotifications({notifications, tx});
  }

  /**
   * List a single recipient's notifications (read AND unread by default).
   * Self-scoped: the caller passes their own user id as `recipientId`, scoped to
   * their active organization. `startDate`/`endDate` optionally bound
   * `createdAt` — omit both for all time; `isRead` (optional) narrows to read or
   * unread only.
   *
   * Request-scoped only: ACL query injection stays enabled so PrismaFactory
   * merges the caller's active-organization predicates from aclAccessMiddleware
   * on top of the explicit recipientId + organizationId scoping.
   *
   * @returns {Promise<{success, docs, count, unreadCount, error}>}
   */
  static async listNotificationsForRecipient({
    recipientId,
    organizationId,
    role,
    startDate,
    endDate,
    isRead,
    skip = 0,
    take = 25,
    sort = null,
  }) {
    try {
      const visibility = await NotificationsServices.buildFeedVisibilityClause({
        recipientId,
        organizationId,
        role,
      });

      // buildDateRangeClause yields {} when neither bound is supplied, so an
      // unfiltered call lists the recipient's notifications for all time.
      const query = NotificationsServices.withFeedVisibility({
        query: Object.assign(
          {recipientId, organizationId},
          buildDateRangeClause({from: startDate, to: endDate})
        ),
        visibility,
      });

      if (isRead !== undefined) {
        query.isRead = isRead === 'true';
      }

      const options = {
        skip,
        take,
        sort: sort || {createdAt: 'desc'},
      };

      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.NOTIFICATION,
        query,
        fieldsInclusion: NOTIFICATION_PERFORMER_INCLUSION,
        options,
      });

      const countResult = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.NOTIFICATION,
        query,
      });

      // Total unread for the recipient across the whole org — independent of the
      // list's date window and isRead filter — so the frontend can render an
      // unread badge regardless of the current view.
      const unreadCountResult = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.NOTIFICATION,
        query: NotificationsServices.withFeedVisibility({
          query: {recipientId, organizationId, isRead: false},
          visibility,
        }),
      });

      // A failed count is a failed list: returning success with count 0 would
      // silently break pagination and the unread badge instead of surfacing it.
      if (
        !result.success ||
        !countResult.success ||
        !unreadCountResult.success
      ) {
        return {
          success: false,
          docs: [],
          count: 0,
          unreadCount: 0,
          error: result.error || countResult.error || unreadCountResult.error,
        };
      }

      return {
        success: true,
        docs: result.docs,
        error: null,
        count: countResult.count,
        unreadCount: unreadCountResult.count,
      };
    } catch (error) {
      logger.error(
        `[Notification] failed to list for recipient ${recipientId}: ${error?.message || error}`
      );

      return {success: false, docs: [], count: 0, unreadCount: 0, error};
    }
  }

  /**
   * List the notifications of every user in an organization (admin view). Same
   * filters and pagination as listNotificationsForRecipient, but not narrowed
   * to one recipient unless `recipientId` is passed. Each row carries its
   * recipient's name and organization role. Always scoped to `organizationId`.
   *
   * @returns {Promise<{success, docs, count, error}>}
   */
  static async listAllNotifications({
    organizationId,
    recipientId,
    startDate,
    endDate,
    isRead,
    skip = 0,
    take = 25,
    sort = null,
  }) {
    try {
      const query = Object.assign(
        {organizationId},
        buildDateRangeClause({from: startDate, to: endDate})
      );

      if (recipientId) query.recipientId = recipientId;
      if (isRead !== undefined) query.isRead = isRead === 'true';

      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.NOTIFICATION,
        query,
        fieldsInclusion: {
          include: {
            performer: PERFORMER_SELECT,
            recipient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,

                // The name shown is the one in this organization.
                userOrganizations: {
                  where: {organizationId},
                  select: {role: true, firstName: true, lastName: true},
                },
              },
            },
          },
        },
        options: {skip, take, sort: sort || {createdAt: 'desc'}},
      });

      const countResult = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.NOTIFICATION,
        query,
      });

      if (!result.success || !countResult.success) {
        return {
          success: false,
          docs: [],
          count: 0,
          error: result.error || countResult.error,
        };
      }

      return {
        success: true,
        docs: result.docs,
        error: null,
        count: countResult.count,
      };
    } catch (error) {
      logger.error(
        `[Notification] failed to list all for org ${organizationId}: ${error?.message || error}`
      );

      return {success: false, docs: [], count: 0, error};
    }
  }

  /**
   * Mark every unread notification for a recipient as read. Self-scoped: the
   * caller passes their own user id, scoped to their active organization. Only
   * currently-unread rows are touched, so readAt reflects the first time each
   * was read. Request-scoped only: ACL query injection stays enabled so the
   * caller's active-organization predicates are merged on top of the explicit
   * recipientId + organizationId scoping.
   *
   * @returns {Promise<{success, count, error}>}
   */
  static async markAllAsReadForRecipient({recipientId, organizationId, role}) {
    try {
      // Hidden rows stay unread, so they come back unread if the caregiver is reassigned.
      const visibility = await NotificationsServices.buildFeedVisibilityClause({
        recipientId,
        organizationId,
        role,
      });

      const {success, error, responseObj} = await PrismaFactory.updateMany({
        model: modelConstants.MODELS.NOTIFICATION,
        query: NotificationsServices.withFeedVisibility({
          query: {recipientId, organizationId, isRead: false},
          visibility,
        }),
        data: {isRead: true, readAt: getCurrentTime()},
      });

      return {success, error, count: responseObj?.count || 0};
    } catch (error) {
      logger.error(
        `[Notification] failed to mark all read for recipient ${recipientId}: ${error?.message || error}`
      );

      return {success: false, count: 0, error};
    }
  }

  /**
   * Mark a single notification as read and return the updated row.
   *
   * Distinguishes the ticket's three failure/edge cases: a notification that
   * does not exist in the org resolves to `{notFound: true}` (→ 404); one that
   * exists but is owned by another user resolves to `{forbidden: true}` (→ 403);
   * an already-read notification is returned unchanged (no second write, so
   * readAt keeps reflecting the first read) for idempotency.
   *
   * The initial lookup is owner-agnostic within the org (bypassExtraQueries) so
   * the not-found vs forbidden split can be made explicitly rather than being
   * collapsed by ACL recipient scoping. `count` is the number of rows actually
   * flipped to read: 1 on a first read, 0 on an idempotent repeat.
   *
   * @returns {Promise<{success, count, notFound, forbidden, error}>}
   */
  static async markAsReadForRecipient({
    notificationId,
    recipientId,
    organizationId,
  }) {
    try {
      // Owner-agnostic lookup within the org so "does not exist" (404) and
      // "belongs to another user" (403) can be told apart.
      const {
        success: findSuccess,
        error: findError,
        doc: existing,
      } = await PrismaFactory.findOne({
        model: modelConstants.MODELS.NOTIFICATION,
        query: {id: notificationId, organizationId},
        options: {bypassExtraQueries: true},
      });

      if (!findSuccess) {
        return {success: false, count: 0, error: findError};
      }

      if (!existing) {
        return {success: true, count: 0, notFound: true};
      }

      if (existing.recipientId !== recipientId) {
        return {success: true, count: 0, forbidden: true};
      }

      // Already read → idempotent no-op; skip the write so readAt keeps
      // reflecting the first read, and report 0 rows flipped.
      if (existing.isRead) {
        return {success: true, count: 0};
      }

      const {success, error} = await PrismaFactory.updateOne({
        model: modelConstants.MODELS.NOTIFICATION,
        query: {id: notificationId, recipientId, organizationId},
        data: {isRead: true, readAt: getCurrentTime()},
        options: {bypassExtraQueries: true},
      });

      // The row was verified to exist, be owned, and be unread just above, so a
      // successful updateOne flipped exactly this one notification.
      return {success, error, count: success ? 1 : 0};
    } catch (error) {
      logger.error(
        `[Notification] failed to mark as read for notification ${notificationId} and recipient ${recipientId}: ${error?.message || error}`
      );

      return {success: false, count: 0, error};
    }
  }
};
