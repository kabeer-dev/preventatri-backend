exports.IDEMPOTENCY_STATUSES = {
  processing: {
    value: 'processing',
  },
  completed: {
    value: 'completed',
  },
  failed: {
    value: 'failed',
  },
};

exports.IDEMPOTENCY_STATUSES_VALUES = Object.values(
  this.IDEMPOTENCY_STATUSES
).map((status) => status.value);

exports.IDEMPOTENCY_TTL_SECONDS = 60; // Changing this constant require an index removal as it's used in mongodb indexes.
