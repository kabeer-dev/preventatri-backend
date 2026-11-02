const config = require('config');
const winston = require('winston');

const {
  getMonitoringProvider,
  MONITORING_PROVIDERS,
} = require('../utils/monitoring');

const {isEnvDev} = require('./../utils/general');

const {combine, timestamp, json, errors} = winston.format;

// Custom formatter to handle object-type errors
const formatErrorObjects = winston.format((logEntry) => {
  if (logEntry.level !== 'error') return logEntry;

  if (logEntry.response && logEntry.response.body)
    logEntry.formattedBody = JSON.stringify(logEntry.response.body, null, 2);

  if (logEntry.response)
    logEntry.response = JSON.stringify(logEntry.response, null, 2);

  return logEntry;
});

const transportsObj = {};

if (isEnvDev) {
  const consoleTransport = new winston.transports.Console({level: 'silly'});

  transportsObj.console = consoleTransport;
} else {
  // In production, add Sentry transport only if using Sentry monitoring
  const monitoringProvider = getMonitoringProvider();

  if (monitoringProvider === MONITORING_PROVIDERS.sentry.value) {
    const Sentry = require('winston-transport-sentry-node').default;

    const sentryTransport = new Sentry({
      sentry: {
        dsn: config.get('sentryDsn'),
        environment: config.get('env'),
        tracesSampleRate: 1.0,
      },
      level: 'info',
    });

    transportsObj.sentry = sentryTransport;
  } else {
    // For X-Ray in production, still need console output
    const consoleTransport = new winston.transports.Console({level: 'info'});

    transportsObj.console = consoleTransport;
  }
}

const logger = winston.createLogger({
  level: 'info',
  exitOnError: false,
  format: combine(
    timestamp(),
    errors({stack: true}),
    formatErrorObjects(),
    json()
  ),
  transports: Object.values(transportsObj),
});

module.exports = logger;
