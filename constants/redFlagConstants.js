const {RISK_SCORE_THRESHOLDS} = require('./riskCalcConstants');

const RED_FLAG_REASONS = {
  0: {label: 'Fall or Injury', value: 0, code: 'fall_or_injury'},
  1: {label: 'Sudden Health Decline', value: 1, code: 'sudden_health_decline'},
  2: {label: 'Unresponsive / Unconscious', value: 2, code: 'unresponsive'},
  3: {label: 'Severe Pain', value: 3, code: 'severe_pain'},
  4: {label: 'Difficulty Breathing', value: 4, code: 'difficulty_breathing'},
  5: {label: 'Medication Issue', value: 5, code: 'medication_issue'},
  6: {label: 'Other', value: 6, code: 'other'},
  7: {label: 'Auto-submission Flag', value: 7, code: 'auto_submission_flag'},
};

const RED_FLAG_REASONS_VALUES = Object.values(RED_FLAG_REASONS).map(
  (reason) => reason.value
);
const AUTO_SUBMISSION_FLAG_REASON = RED_FLAG_REASONS[7].value;

const RED_FLAG_SORT_FIELDS = {
  createdAt: {value: 'createdAt', searchValue: 'createdAt'},
  reason: {value: 'reason', searchValue: 'reason'},
};

const RED_FLAG_SORT_FIELDS_VALUES = Object.values(RED_FLAG_SORT_FIELDS).map(
  (field) => field.value
);

const RED_FLAG_IMAGE_FILE_SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB
const RED_FLAG_AUDIO_FILE_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB
const RED_FLAG_MAX_IMAGES = 5;

// Allowed values for the emergency-flags list `flag` query param.
// GREEN is excluded: the endpoint only surfaces YELLOW and RED flags.
const EMERGENCY_FLAG_FILTER_VALUES = [
  RISK_SCORE_THRESHOLDS.YELLOW.flag,
  RISK_SCORE_THRESHOLDS.RED.flag,
];

// Default flag colours returned when no `flag` filter is supplied.
const EMERGENCY_FLAG_DEFAULT_FLAGS = EMERGENCY_FLAG_FILTER_VALUES;

module.exports = {
  RED_FLAG_REASONS,
  RED_FLAG_REASONS_VALUES,
  AUTO_SUBMISSION_FLAG_REASON,
  RED_FLAG_SORT_FIELDS,
  RED_FLAG_SORT_FIELDS_VALUES,
  RED_FLAG_IMAGE_FILE_SIZE_LIMIT,
  RED_FLAG_AUDIO_FILE_SIZE_LIMIT,
  RED_FLAG_MAX_IMAGES,
  EMERGENCY_FLAG_FILTER_VALUES,
  EMERGENCY_FLAG_DEFAULT_FLAGS,
};
