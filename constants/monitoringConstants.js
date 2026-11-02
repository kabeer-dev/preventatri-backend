const MONITORING_PROVIDERS = {
  sentry: {
    value: 'sentry',
  },
  xray: {
    value: 'xray',
  },
};

const DEFAULT_MONITORING_PROVIDER = MONITORING_PROVIDERS.sentry.value;

module.exports = {
  MONITORING_PROVIDERS,
  DEFAULT_MONITORING_PROVIDER,
};
