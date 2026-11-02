const {IDEMPOTENCY_STATUSES} = require('../constants/idempotencyConstants');
const {IdempotencyErrorsFactories} = require('../factories');
const IdempotencyModel = require('../models/IdempotencyModel');

const {GeneralServices} = require('../services');

const {generateIdempotencyKey} = require('../utils/idempotencyUtils');

module.exports = async (req, res, next) => {
  try {
    const key = generateIdempotencyKey({req});

    const {doc: existingDoc} = await GeneralServices.findOne({
      model: IdempotencyModel,
      query: {key},
    });

    if (existingDoc) {
      const {status} = existingDoc;

      switch (status) {
        case IDEMPOTENCY_STATUSES.failed.value:
          // Allow immediate retry for failed requests
          await GeneralServices.findOneAndUpdate({
            model: IdempotencyModel,
            query: {key},
            data: {status: IDEMPOTENCY_STATUSES.processing.value},
          });
          break;

        default:
          // Block all processing/completed requests
          // User must wait for MongoDB TTL to clean up (max 2 minutes)
          throw IdempotencyErrorsFactories.idempotencyKeyAlreadyProcessing();
      }
    } else {
      // No existing record - create new one
      try {
        await GeneralServices.create({
          model: IdempotencyModel,
          data: {
            key,
            status: IDEMPOTENCY_STATUSES.processing.value,
          },
        });
      } catch (createError) {
        // Handle duplicate key error (E11000) from race condition
        if (createError.code === 11000) {
          throw IdempotencyErrorsFactories.idempotencyKeyAlreadyProcessing();
        } else {
          // Re-throw if it's not a duplicate key error
          throw createError;
        }
      }
    }

    // Update status after response is sent
    res.on('finish', async () => {
      const isSuccess = res.statusCode >= 200 && res.statusCode < 300;
      await GeneralServices.findOneAndUpdate({
        model: IdempotencyModel,
        query: {key},
        data: {
          status: isSuccess
            ? IDEMPOTENCY_STATUSES.completed.value
            : IDEMPOTENCY_STATUSES.failed.value,
        },
      });
    });
    next();
  } catch (error) {
    throw IdempotencyErrorsFactories.idempotencyCheckFailed();
  }
};
