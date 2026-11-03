const AppResponse = require('./app');

const {
  NOTIFICATION_SUCCESS_TYPES,
} = require('../../constants/responses/success/notifications');

const NotificationsHelpers = require('../../helpers/notificationsHelpers');
const {withMembershipDetails} = require('../../utils/userUtils');

module.exports = class NotificationsResponsesFactories {
  static formatNotification({notification}) {
    return NotificationsHelpers.formatForClient({notification});
  }

  // The recipient's name and role in the listed organization (its only loaded
  // membership).
  static formatRecipient({recipient}) {
    const membership = recipient.userOrganizations?.[0];
    const person = withMembershipDetails({user: recipient, membership});

    return {
      id: recipient.id,
      firstName: person.firstName,
      lastName: person.lastName,
      role: membership?.role,
    };
  }

  static notificationsMarkedRead({count}) {
    return new AppResponse({
      message: 'Notifications marked as read successfully',
      statusCode: 200,
      body: {
        updatedCount: count,
        type: NOTIFICATION_SUCCESS_TYPES.notificationsMarkedRead.value,
      },
    });
  }

  static notificationMarkedRead({count}) {
    // count is the number of rows flipped to read: 1 on a first read, 0 on an
    // idempotent repeat (already read).
    return new AppResponse({
      message: 'Notification marked as read successfully',
      statusCode: 200,
      body: {
        updatedCount: count,
        type: NOTIFICATION_SUCCESS_TYPES.notificationMarkedRead.value,
      },
    });
  }

  static allNotificationsListed({notifications, meta}) {
    return new AppResponse({
      message: 'Notifications retrieved successfully',
      statusCode: 200,
      body: {
        notifications: (notifications || []).map((notification) =>
          Object.assign(
            NotificationsResponsesFactories.formatNotification({notification}),
            {
              recipient: notification.recipient
                ? NotificationsResponsesFactories.formatRecipient({
                    recipient: notification.recipient,
                  })
                : null,
            }
          )
        ),
        meta,
        type: NOTIFICATION_SUCCESS_TYPES.notificationsListed.value,
      },
    });
  }

  static notificationsListed({notifications, unreadCount = 0, meta}) {
    return new AppResponse({
      message: 'Notifications retrieved successfully',
      statusCode: 200,
      body: {
        notifications: (notifications || []).map((notification) =>
          NotificationsResponsesFactories.formatNotification({notification})
        ),
        unreadCount,
        meta,
        type: NOTIFICATION_SUCCESS_TYPES.notificationsListed.value,
      },
    });
  }
};
