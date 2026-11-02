const config = require('config');

// Import the logger directly (not via the middleware index) — that index
// participates in a require cycle with services → bullMQ → redis, and this file
// is pulled in by lib/bullBoard during app wiring.
const logger = require('./loggerMiddleware');

const {BULL_BOARD_AUTH_REALM} = require('../constants/queueConstants');

const {
  BULL_BOARD_ERRORS_TYPES,
} = require('../constants/responses/errors/bullBoard');
const {safeEqual} = require('../utils');

// HTTP Basic-Auth gate for the Bull Board dashboard. Credentials come from
// config (BULL_BOARD_USERNAME / BULL_BOARD_PASSWORD); a missing password means
// the board is misconfigured and every request is refused.
const bullBoardAuthMiddleware = (req, res, next) => {
  const expectedUser = config.get('bullBoard.username');
  const expectedPassword = config.get('bullBoard.password');

  if (!expectedPassword) {
    logger.warn('Bull Board password not set; refusing dashboard access');

    return res.status(503).send(BULL_BOARD_ERRORS_TYPES.notConfigured.value);
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    const user = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);

    const userOk = safeEqual({actual: user, expected: expectedUser});

    const passwordOk = safeEqual({
      actual: password,
      expected: expectedPassword,
    });

    if (userOk && passwordOk) return next();
  }

  res.set('WWW-Authenticate', BULL_BOARD_AUTH_REALM);

  return res.status(401).send(BULL_BOARD_ERRORS_TYPES.authRequired.value);
};

module.exports = bullBoardAuthMiddleware;
