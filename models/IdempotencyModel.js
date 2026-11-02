const mongoose = require('mongoose');

const {
  IDEMPOTENCY_STATUSES_VALUES,
  IDEMPOTENCY_STATUSES,
  IDEMPOTENCY_TTL_SECONDS,
} = require('../constants/idempotencyConstants');

const {Schema} = mongoose;

const idempotencySchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: IDEMPOTENCY_STATUSES_VALUES,
      default: IDEMPOTENCY_STATUSES.processing.value,
    },
  },
  {
    timestamps: true,
    id: false,
    versionKey: false,
  }
);

// TTL index on updatedAt for auto-deletion after 60 seconds from last update
idempotencySchema.index(
  {updatedAt: 1},
  {expireAfterSeconds: IDEMPOTENCY_TTL_SECONDS}
);

module.exports = mongoose.model('Idempotency', idempotencySchema);
