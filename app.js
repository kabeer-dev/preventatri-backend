const bodyParser = require('body-parser');
const config = require('config');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const express = require('express');
const swaggerUi = require('swagger-ui-express');

const v1 = require('./apiVersions/v1');

const {mountBullBoard} = require('./lib/bullBoard');

const {
  refreshTokenMiddleware,
  finalResponseMiddleware,
  errorMiddleware,
  ddosProtectionMiddleware,
  setPlatformMiddleware,
  requestLoggerMiddleware,
} = require('./middleware');
const maintenanceMiddleware = require('./middleware/maintenanceMiddleware');

const loadSwaggerDocs = require('./swagger');
const {corsOrigins} = require('./utils');

const {setupExpressErrorHandler} = require('./utils/monitoring');

const {initializeContext} = require('./utils/requestContext');

const app = express();

// Live runs behind the AWS load balancer: without this, req.ip (audit logs,
// sessions, rate limit) is the balancer's private address, not the user's.
app.set('trust proxy', config.get('trustProxyHops'));

app.use(express.json());

app.use(cookieParser());
app.use(bodyParser.urlencoded({extended: true}));
app.use(cors({origin: corsOrigins, credentials: true}));

// Mounted before DDoS/audit middleware so the dashboard's many asset requests
// aren't rate-limited or audit-logged. Guarded by its own Basic-Auth and only
// active when BULL_BOARD_ENABLED is true.
mountBullBoard({app});

app.use(maintenanceMiddleware);
app.use((req, res, next) => {
  req.extra = req.extra || {};
  req.extra.flags = req.extra.flags || {};
  req.extra.entities = req.extra.entities || {};
  req.extra.queries = req.extra.queries || {};
  req.extra.options = req.extra.options || {};

  // Run all downstream middleware/routes within request context
  initializeContext({context: {req}, nextFn: next});
});

// set platform early so routes and downstream middleware can use it
app.use(setPlatformMiddleware);

app.use(ddosProtectionMiddleware);

// Global audit logger — automatically logs every request + before/after to AuditLog
// Placed after DDoS protection so rate-limited requests aren't audit-logged
app.use(requestLoggerMiddleware);

v1.prepareV1Routes({app});

const swagger = loadSwaggerDocs();
app.use('/api/v1/docs', swaggerUi.serve, swaggerUi.setup(swagger));

app.get('/awake', (req, res) => {
  res.json();
});

// All other GET requests not handled before will return simple HTML
app.use((req, res, next) => {
  if (req?.extra?.appResponse) return next();
  res.status(200).setHeader('Content-Type', 'text/html');
  res.end('<html><body><h1>This is an Express Server</h1></body></html>');
});

app.use(refreshTokenMiddleware);

// Monitoring error handler (Sentry for sentry mode, no-op for xray)
setupExpressErrorHandler({app});

app.use(finalResponseMiddleware);
app.use(errorMiddleware);

module.exports = app;
