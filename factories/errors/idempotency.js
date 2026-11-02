const AppError = require('./app');

const {
  IDEMPOTENCY_ERROR_TYPES,
} = require('../../constants/responses/errors/idempotency');

module.exports = class IdempotencyErrorsFactories {
  static idempotencyKeyAlreadyProcessing() {
    return new AppError({
      message: 'Duplicate request detected. Please try again after 2 minutes.',
      statusCode: 429,
      error: {
        type: IDEMPOTENCY_ERROR_TYPES.alreadyProcessing.value,
      },
    });
  }
  static idempotencyCheckFailed() {
    return new AppError({
      message: 'Internal server error',
      statusCode: 500,
      error: {
        type: IDEMPOTENCY_ERROR_TYPES.checkFailed.value,
      },
    });
  }
};
