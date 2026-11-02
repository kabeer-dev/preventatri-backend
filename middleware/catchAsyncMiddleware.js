const logger = require('./loggerMiddleware');

const {
  isAuthError,
  rotateAndReconnect,
} = require('../utils/databaseConnectionManager');

/**
 * HTTP methods that are safe to retry automatically.
 * Per RFC 7231, safe methods (GET, HEAD, OPTIONS) are read-only and have no
 * side effects, so re-executing them after a credential rotation is harmless.
 * Unsafe methods (POST, PUT, PATCH, DELETE) must NOT be retried automatically
 * because they may have already produced a side effect (e.g. a DB write) before
 * the auth error was thrown, and re-running them would duplicate that effect.
 */
const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Executes a handler with automatic credential rotation on DB auth errors.
 *
 * Safe methods  (GET/HEAD/OPTIONS): credentials are rotated and the handler
 *   is retried once — zero risk of duplicate side effects.
 * Unsafe methods (POST/PUT/PATCH/DELETE): credentials are still rotated so
 *   subsequent requests succeed, but the original error is forwarded to the
 *   Express error handler so the client can decide whether to retry safely.
 *
 * @param {Function} fn - Express route handler
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next
 * @param {number} retryCount - Retry counter (0 = first attempt, 1 = after rotation)
 */
async function executeWithRotationRetry(fn, req, res, next, retryCount = 0) {
  try {
    const appResponse = await fn(req, res, next);

    if (appResponse) req.extra.appResponse = appResponse;

    req.extra.flags.isRequestFullFilled = true;

    return next();
  } catch (error) {
    // On first failure, check if it's a DB auth error
    if (isAuthError({error}) && retryCount === 0) {
      try {
        // Always rotate credentials so future requests (or a client retry) work.
        await rotateAndReconnect();

        // Only re-execute the handler for safe (read-only) HTTP methods.
        // Unsafe methods may have already performed a side effect before the
        // auth error occurred; retrying them risks duplicate writes.
        if (SAFE_HTTP_METHODS.has(req.method?.toUpperCase())) {
          return executeWithRotationRetry(fn, req, res, next, 1);
        }

        // Unsafe method: credentials rotated, but surface the error so the
        // client can retry the full request (idempotency-safe from the outside).
        return next(error);
      } catch (rotationError) {
        logger.error({
          message: 'Credential rotation failed',
          error: rotationError.message,
        });

        return next(rotationError);
      }
    }

    // Non-auth error or second failure — propagate immediately
    return next(error);
  }
}

module.exports = (fn) => async (req, res, next) => {
  return executeWithRotationRetry(fn, req, res, next, 0);
};
