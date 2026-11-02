const {Router} = require('express');

const {SecuritiesController} = require('../../controllers');

const {validatorMiddleware, catchAsyncMiddleware} = require('../../middleware');

const {securitySchema} = require('../../schemas');

const router = Router();

// GET /securities/otp-methods — the authenticated user's OTP method
// preferences (which channels are required during the OTP verification
// flow). Self-scoped to the caller.
router.get(
  '/otp-methods',
  catchAsyncMiddleware(SecuritiesController.getOtpMethods)
);

// PATCH /securities/otp-methods — update the authenticated user's OTP
// method preferences. Body: { otpMethods: { email: boolean, phone: boolean } }.
// Self-scoped to the caller.
router.patch(
  '/otp-methods/:id',
  validatorMiddleware({
    validateFunction: securitySchema.validateOtpMethodsIdParams,
    reqProperty: 'params',
  }),
  validatorMiddleware({
    validateFunction: securitySchema.validateUpdateOtpMethods,
    reqProperty: 'body',
  }),
  catchAsyncMiddleware(SecuritiesController.updateOtpMethods)
);

module.exports = router;
