const express = require('express');

const {SessionsController} = require('../../controllers');
const {catchAsyncMiddleware} = require('../../middleware');

const router = express.Router();

router.get('/', catchAsyncMiddleware(SessionsController.getSessions));

router.delete(
  '/signout-other-devices',
  catchAsyncMiddleware(SessionsController.signOutOtherDevices)
);

router.delete(
  '/signout/:sessionId',
  catchAsyncMiddleware(SessionsController.revokeSession)
);

module.exports = router;
