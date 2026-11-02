/**
 * Unified Monitoring Module
 * Handles both Sentry and AWS X-Ray based on MONITORING_PROVIDER env variable
 */

const config = require('config');

const {
  MONITORING_PROVIDERS,
  DEFAULT_MONITORING_PROVIDER,
} = require('../../constants/monitoringConstants');

// Lazy-loaded dependencies to avoid loading unused ones
let Sentry = null;
let trace = null;
let SpanStatusCode = null;

let isInitialized = false;

const getMonitoringProvider = () => {
  const provider =
    config.get('monitoringProvider') || DEFAULT_MONITORING_PROVIDER;

  return provider;
};

const initializeMonitoring = () => {
  if (isInitialized) return;

  const provider = getMonitoringProvider();

  if (provider === MONITORING_PROVIDERS.sentry.value) {
    Sentry = require('@sentry/node');
    const {nodeProfilingIntegration} = require('@sentry/profiling-node');

    Sentry.init({
      dsn: config.get('sentryDsn'),
      integrations: [
        nodeProfilingIntegration(),
        Sentry.httpIntegration(),
        Sentry.onUncaughtExceptionIntegration(),
        Sentry.onUnhandledRejectionIntegration(),
      ],
      tracesSampleRate: 1.0,
      profilesSampleRate: 1.0,
      beforeSend(event) {
        return !event?.extra?.isKnown || event?.extra?.submitForMonitoring
          ? event
          : null;
      },
    });
  }

  // X-Ray initialization is handled via --require flag in package.json scripts

  isInitialized = true;
};

const sendErrorTrace = ({error, source, req = null}) => {
  const provider = getMonitoringProvider();

  // Sentry handles errors via its own integrations - no manual trace needed
  if (provider !== MONITORING_PROVIDERS.xray.value) return;

  // Lazy load OpenTelemetry for X-Ray
  if (!trace) {
    const otel = require('@opentelemetry/api');
    trace = otel.trace;
    SpanStatusCode = otel.SpanStatusCode;
  }

  const TRACER_NAME = 'app-error-tracer';
  const tracer = trace.getTracer(TRACER_NAME);

  const attributes = {
    'error.source': source,
    'error.type': error?.name || 'unknown',
    'error.internal_type': error?.type || 'unknown',
    'service.environment': config.get('env'),
    'process.pid': process.pid,
  };

  if (req) {
    attributes['http.method'] = req.method;
    attributes['http.url'] = req.originalUrl;
    attributes['http.status_code'] = error?.statusCode || 500;
    attributes['user.id'] =
      req.extra?.entities?.user?.id?.toString() || 'anonymous';
  }

  const span = tracer.startSpan('error', {attributes});

  span.recordException(error);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error?.message || String(error),
  });

  span.end();
};

const setupExpressErrorHandler = ({app}) => {
  const provider = getMonitoringProvider();

  // Only Sentry needs an Express error handler
  if (provider === MONITORING_PROVIDERS.sentry.value && Sentry) {
    Sentry.setupExpressErrorHandler(app);
  }

  // X-Ray doesn't need an Express error handler - traces are sent manually
};

module.exports = {
  initializeMonitoring,
  sendErrorTrace,
  setupExpressErrorHandler,
  getMonitoringProvider,
  MONITORING_PROVIDERS,
};
