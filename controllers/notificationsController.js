const {
  NOTIFICATION_SORT_FIELDS,
} = require('../constants/notificationConstants');

const {
  GeneralErrorsFactories,
  NotificationsResponsesFactories,
} = require('../factories');

const {NotificationsServices} = require('../services');

const {buildOrderByClause, getListParams} = require('../utils/general');

module.exports = class NotificationsController {
  static async listNotifications(req, res, next) {
    const {page, limit, skip, sortBy, sortDir} = getListParams({req});
    const {startDate, endDate, isRead} = req.query;

    const token = req.extra.jwtToken;
    const recipientId = token.user.id;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    // startDate/endDate are optional filters — the list is all time when both
    // are omitted. Keep it unbounded to stay consistent with unreadCount, which
    // is all-time: any default window here lets the bell badge count
    // notifications the list can never return.
    const orderBy = buildOrderByClause({
      sortBy,
      sortDir,
      sortFields: NOTIFICATION_SORT_FIELDS,
    });

    const {
      success,
      docs: notifications,
      error,
      count,
      unreadCount,
    } = await NotificationsServices.listNotificationsForRecipient({
      recipientId,
      organizationId,
      role: token.user.currentActiveOrganization.role,
      startDate,
      endDate,
      isRead,
      skip,
      take: limit,
      sort: orderBy,
    });

    if (!success || error)
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch notifications',
      });

    return NotificationsResponsesFactories.notificationsListed({
      notifications,
      unreadCount,
      meta: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        count,
        totalPages: Math.ceil(count / limit),
      },
    });
  }

  static async listAllNotifications(req, res, next) {
    const {page, limit, skip, sortBy, sortDir} = getListParams({req});
    const {startDate, endDate, isRead, recipientId} = req.query;

    const organizationId =
      req.extra.jwtToken.user.currentActiveOrganization.organizationId;

    const orderBy = buildOrderByClause({
      sortBy,
      sortDir,
      sortFields: NOTIFICATION_SORT_FIELDS,
    });

    const {
      success,
      docs: notifications,
      error,
      count,
    } = await NotificationsServices.listAllNotifications({
      organizationId,
      recipientId,
      startDate,
      endDate,
      isRead,
      skip,
      take: limit,
      sort: orderBy,
    });

    if (!success || error)
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch notifications',
      });

    return NotificationsResponsesFactories.allNotificationsListed({
      notifications,
      meta: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        count,
        totalPages: Math.ceil(count / limit),
      },
    });
  }

  static async markAllAsRead(req, res, next) {
    const token = req.extra.jwtToken;
    const recipientId = token.user.id;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    const {success, error, count} =
      await NotificationsServices.markAllAsReadForRecipient({
        recipientId,
        organizationId,
        role: token.user.currentActiveOrganization.role,
      });

    if (!success || error)
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to mark notifications as read',
      });

    return NotificationsResponsesFactories.notificationsMarkedRead({count});
  }

  static async markAsRead(req, res, next) {
    const token = req.extra.jwtToken;
    const recipientId = token.user.id;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    const {id: notificationId} = req.params;

    const {success, error, count, notFound, forbidden} =
      await NotificationsServices.markAsReadForRecipient({
        recipientId,
        organizationId,
        notificationId,
      });

    if (notFound)
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Notification not found',
      });

    if (forbidden)
      throw GeneralErrorsFactories.forbiddenErr({
        customMessage: 'Notification belongs to another user',
      });

    if (!success || error)
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to mark notification as read',
      });

    return NotificationsResponsesFactories.notificationMarkedRead({count});
  }
};
