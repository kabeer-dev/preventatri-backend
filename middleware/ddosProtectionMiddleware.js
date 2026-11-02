const config = require('config');
const {rateLimit} = require('express-rate-limit');

const {GeneralErrorsFactories} = require('../factories');

module.exports = rateLimit({
  windowMs: config.get('windowSizeInMinutes') * 60 * 1000,

  // TODO: adjust maxRequestsAllowed in config/default.json per environment load requirements
  max: config.get('maxRequestsAllowed'),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => {
    return req.method === 'OPTIONS' || req.url === '/favicon.ico';
  },
  handler: (req, res, next, options) => {
    return next(GeneralErrorsFactories.tooManyRequestsErr());
  },
});

// Brute-force guard for the Bull Board dashboard's Basic-Auth. The board is
// intentionally exempt from the global limiter above (so its many asset requests
// aren't throttled), which would otherwise leave the login unprotected. This
// limiter counts only FAILED requests (skipSuccessfulRequests → 2xx/3xx asset
// loads don't count), so authenticated browsing stays unthrottled while repeated
// failed/unauthenticated attempts are capped.
module.exports.bullBoardAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res, next, options) => {
    return next(GeneralErrorsFactories.tooManyRequestsErr());
  },
});
