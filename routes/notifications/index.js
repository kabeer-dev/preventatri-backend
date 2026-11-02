const {Router} = require('express');

const {
  SYSTEM_ENTITIES,
  CRUD_PERMISSIONS,
  NOTIFICATION_PERMISSIONS,
} = require('../../constants/aclConstants');

const {NotificationsController} = require('../../controllers');

const {
  validatorMiddleware,
  catchAsyncMiddleware,
  aclAccessMiddleware,
} = require('../../middleware');

const {notificationsSchema} = require('../../schemas');

const router = Router();

const NOTIFICATION_ENTITY = SYSTEM_ENTITIES.notification.value;

// GET /notifications — list the authenticated user's notifications (read &
// unread), optionally narrowed by a startDate/endDate window; all time when
// both are omitted. Self-scoped to the caller (recipientId) and their active
// organization. Restricted to Admins, Nurses, Case Managers, and Caregivers via
// entity-level ACL.
router.get(
  '/',
  validatorMiddleware({
    validateFunction: notificationsSchema.validateListNotificationsQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: NOTIFICATION_ENTITY,
    permissionKey: CRUD_PERMISSIONS.VIEW,
  }),
  catchAsyncMiddleware(NotificationsController.listNotifications)
);

// GET /notifications/all — admin-only: list the notifications of every user in
// the admin's active organization (read & unread), with the same pagination,
// date window and isRead filters as the self-scoped list, plus an optional
// recipientId filter. Each notification includes its recipient's name and role.
router.get(
  '/all',
  validatorMiddleware({
    validateFunction: notificationsSchema.validateListAllNotificationsQuery,
    reqProperty: 'query',
  }),
  aclAccessMiddleware({
    entityToCheck: NOTIFICATION_ENTITY,
    permissionKey: NOTIFICATION_PERMISSIONS.VIEW_ALL,
  }),
  catchAsyncMiddleware(NotificationsController.listAllNotifications)
);

// PATCH /notifications/read-all — mark all of the authenticated user's unread
// notifications as read. Self-scoped to the caller and their active organization.
router.patch(
  '/read-all',
  catchAsyncMiddleware(NotificationsController.markAllAsRead)
);

// PATCH /notifications/:id/read — mark a single notification as read for the
// authenticated user. The :id param is the notification's UUID. Self-scoped to
// the caller (recipientId) and their active organization. Returns the updated
// notification with the new isRead state.
router.patch(
  '/:id/read',
  catchAsyncMiddleware(NotificationsController.markAsRead)
);

module.exports = router;
