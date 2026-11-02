const {createBullBoard} = require('@bull-board/api');
const {BullMQAdapter} = require('@bull-board/api/bullMQAdapter');
const {ExpressAdapter} = require('@bull-board/express');
const config = require('config');

const {alertsQueue} = require('../bullMQ/queues/alertsQueue');
const {followUpTasksQueue} = require('../bullMQ/queues/followUpTasksQueue');
const {notificationsQueue} = require('../bullMQ/queues/notificationsQueue');

const {apiPrefix} = require('../../apiVersions/v1');
const bullBoardAuthMiddleware = require('../../middleware/bullBoardAuthMiddleware');

const {
  bullBoardAuthLimiter,
} = require('../../middleware/ddosProtectionMiddleware');

// Where the dashboard is served. Kept off the /api/v1 tree so it sits behind its
// own Basic-Auth guard rather than the JWT/cookie auth the API routes use (a
// browser embedding the board can't ride the app's cookie session cleanly).
const BULL_BOARD_BASE_PATH = `${apiPrefix}admin/queues`;

// Mounts the Bull Board dashboard on the app when enabled. No-op unless
// BULL_BOARD_ENABLED is true, so it stays off in every environment that doesn't
// explicitly opt in. Exposes the alerts + notification-delivery queues.
const mountBullBoard = ({app}) => {
  if (!config.get('bullBoard.enabled')) return;

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_BASE_PATH);

  createBullBoard({
    queues: [
      new BullMQAdapter(alertsQueue, {readOnlyMode: true}),
      new BullMQAdapter(notificationsQueue, {readOnlyMode: true}),
      new BullMQAdapter(followUpTasksQueue, {readOnlyMode: true}),
    ],
    serverAdapter,
  });

  app.use(
    BULL_BOARD_BASE_PATH,
    bullBoardAuthLimiter,
    bullBoardAuthMiddleware,
    serverAdapter.getRouter()
  );
};

module.exports = {mountBullBoard, BULL_BOARD_BASE_PATH};
