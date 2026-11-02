// Startup: dotenv is loaded via --require flag in package.json scripts
// Initialize monitoring FIRST (before app.js loads)
// This ensures Sentry is ready when setupExpressErrorHandler is called in app.js
require('./utils/monitoring').initializeMonitoring();

const config = require('config');

const app = require('./app');

const {startWorkers} = require('./lib/bullMQ');

const {connectRedis} = require('./lib/redis');

const logger = require('./middleware/loggerMiddleware');

const socket = require('./socket');

// const {setupIdempotencyCleanup} = require('./utils/cronJobsUtils');
const {
  setupChecklistSubmissionGeneration,
} = require('./utils/checklistSubmissionCronUtils');

const {connectDatabase} = require('./utils/databaseConnectionManager');

const {setupEscalationProcessing} = require('./utils/escalationCronUtils');

const {setupHhaSync} = require('./utils/hhaSyncCronUtils');

const {
  sendErrorTrace,
  getMonitoringProvider,
  MONITORING_PROVIDERS,
} = require('./utils/monitoring');

const {
  setupExpiredSessionsCleanup,
} = require('./utils/sessionCleanupCronUtils');

const {setupWorkItemScheduling} = require('./utils/workItemCronUtils');

const io = socket.prepare({app}); // In case the app doesn't require sockets, you can just comment the following part
const socketFlag = config.get('socket');
app.set(socketFlag, io);
module.exports.socket = app.get(socketFlag);

(async () => {
  try {
    await connectDatabase({maxRetries: 5, retryDelay: 2000});
    await connectRedis();
    startWorkers();
    await setupChecklistSubmissionGeneration();
    await setupEscalationProcessing();
    await setupWorkItemScheduling();
    await setupHhaSync();
    await setupExpiredSessionsCleanup();
  } catch (error) {
    logger.error('Failed to initialize application:', error);
    process.exit(1);
  }
})();

// For X-Ray mode, we need manual process handlers since X-Ray doesn't have built-in ones
// Sentry handles uncaughtException and unhandledRejection automatically via its SDK
if (getMonitoringProvider() === MONITORING_PROVIDERS.xray.value) {
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    sendErrorTrace({error, source: 'uncaughtException'});

    // Wait for traces to export before exiting
    setTimeout(() => process.exit(1), 2000);
  });

  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error('Unhandled Rejection:', error);
    sendErrorTrace({error, source: 'unhandledRejection'});
  });
}

if (config.get('env') == config.get('envVariables.prod')) {
  // Here put anything/script that needs to run on production alone
}

if (config.get('env') == config.get('envVariables.dev')) {
  const testOnDevelopment = async () => {};

  testOnDevelopment();
}
