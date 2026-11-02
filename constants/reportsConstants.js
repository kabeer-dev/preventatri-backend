const {
  ESCALATION_ACTIONS,
  NURSE_ESCALATION_LEVELS,
} = require('./escalationConstants');
const {ESCALATABLE_FLAGS} = require('./riskCalcConstants');

// Luxon unit names and Postgres date_trunc units are the same words.
const REPORT_GRAINS = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
};

// Day buckets up to 14 days, week up to 183, month beyond.
const REPORT_GRAIN_LIMITS = {
  DAY_MAX_SPAN: 14,
  WEEK_MAX_SPAN: 183,
};

const REPORT_DEFAULT_WINDOW_DAYS = 30;
const REPORT_MAX_SPAN_DAYS = 366;

const REPORT_ALERT_FLAGS = ESCALATABLE_FLAGS;

// An escalation event closed by the timer: one missed page.
const REPORT_TIMEOUT_ACTIONS = [
  ESCALATION_ACTIONS.ESCALATED.value,
  ESCALATION_ACTIONS.EXPIRED.value,
];

const REPORT_NURSE_LEVELS = NURSE_ESCALATION_LEVELS;

const REPORT_ASSESSMENT_OUTCOMES = {
  ON_TIME: 'ON_TIME',
  OPEN: 'OPEN',
};

const REPORT_PATIENT_TRENDS = {
  WORSENING: 'WORSENING',
  IMPROVING: 'IMPROVING',
  STABLE: 'STABLE',
};

const REPORT_PATIENT_TRENDS_VALUES = Object.values(REPORT_PATIENT_TRENDS);

// Risk rank rules, tunable by the clinical team.
const REPORT_WATCHLIST_RULES = {
  previousScoresCompared: 3,
  minScoreRise: 5,
  minScoredSubmissions: 2,
  maxPatients: 10,
  rankWeights: {redAlert: 10, yellowAlert: 3, worsening: 5, overdueFollowUp: 2},
};

// Coverage tiles are counts only.
const REPORT_COVERAGE = {
  licenseWarningDays: 30,
};

const REPORT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Query params that narrow a report to a region or to people's patients.
const REPORT_SCOPE_PARAMS = [
  'regionId',
  'caregiverUserId',
  'caseManagerUserId',
  'nurseUserId',
  'patientId',
];

module.exports = {
  REPORT_SCOPE_PARAMS,
  REPORT_GRAINS,
  REPORT_GRAIN_LIMITS,
  REPORT_DEFAULT_WINDOW_DAYS,
  REPORT_MAX_SPAN_DAYS,
  REPORT_ALERT_FLAGS,
  REPORT_TIMEOUT_ACTIONS,
  REPORT_NURSE_LEVELS,
  REPORT_WATCHLIST_RULES,
  REPORT_COVERAGE,
  REPORT_DATE_PATTERN,
  REPORT_ASSESSMENT_OUTCOMES,
  REPORT_PATIENT_TRENDS,
  REPORT_PATIENT_TRENDS_VALUES,
};
