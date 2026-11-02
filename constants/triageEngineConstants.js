// Default look-back window (days) for the GREEN flag count on the triage-engine
// stats endpoint when the client doesn't supply an explicit date range. The
// frontend can override via startDate/endDate query params.
const TRIAGE_GREEN_FLAG_DEFAULT_LOOKBACK_DAYS = 30;

module.exports = {
  TRIAGE_GREEN_FLAG_DEFAULT_LOOKBACK_DAYS,
};
