const SUBMISSION_FLAG_TYPE = {
  AUTO: 'AUTO',
  MANUAL: 'MANUAL',
};

const SUBMISSION_FLAG_STATUS = {
  PENDING: 'PENDING',

  // The escalation assignee accepted it: it stops escalating and stays with
  // them until resolved.
  ACCEPTED: 'ACCEPTED',
  VOIDED: 'VOIDED',
  RESOLVED: 'RESOLVED',
};

const SUBMISSION_FLAG_STATUS_VALUES = Object.values(SUBMISSION_FLAG_STATUS);

// Flags still being handled: waiting on someone, or accepted and not resolved.
const SUBMISSION_FLAG_OPEN_STATUSES = [
  SUBMISSION_FLAG_STATUS.PENDING,
  SUBMISSION_FLAG_STATUS.ACCEPTED,
];

// A flag can only be voided while still open; resolved/voided are terminal.
const SUBMISSION_FLAG_VOIDABLE_STATUSES = SUBMISSION_FLAG_OPEN_STATUSES;

module.exports = {
  SUBMISSION_FLAG_TYPE,
  SUBMISSION_FLAG_STATUS,
  SUBMISSION_FLAG_STATUS_VALUES,
  SUBMISSION_FLAG_OPEN_STATUSES,
  SUBMISSION_FLAG_VOIDABLE_STATUSES,
};
