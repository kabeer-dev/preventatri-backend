const RISK_SCORE_THRESHOLDS = {
  GREEN: {min: 0, max: 14, category: 'LOW', flag: 'GREEN'},
  YELLOW: {min: 15, max: 29, category: 'MODERATE', flag: 'YELLOW'},
  RED: {min: 30, max: Infinity, category: 'HIGH', flag: 'RED'},
};

const RISK_SCORE_THRESHOLDS_ARR = Object.values(RISK_SCORE_THRESHOLDS);

const ESCALATABLE_FLAGS = [
  RISK_SCORE_THRESHOLDS.RED.flag,
  RISK_SCORE_THRESHOLDS.YELLOW.flag,
];

module.exports = {
  RISK_SCORE_THRESHOLDS,
  RISK_SCORE_THRESHOLDS_ARR,
  ESCALATABLE_FLAGS,
};
