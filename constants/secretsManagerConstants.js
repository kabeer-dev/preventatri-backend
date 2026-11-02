// ---------------------------------------------------------------------------
// AWS Secrets Manager & credential-rotation constants
// ---------------------------------------------------------------------------

/**
 * Default fallback for how long (in ms) a cached secret lives.
 * In production the TTL is derived from the RotationSchedule metadata
 * returned by AWS DescribeSecret, so this only applies when:
 *   - DescribeSecret fails or is not configured
 *   - The secret has no rotation schedule
 */
const DEFAULT_CACHE_TTL_MS = 3_600_000; // 1 hour

/**
 * Retry configuration for transient AWS API failures.
 * Uses exponential back-off: baseDelayMs * 2^(attempt-1)
 */
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 200,
};

/**
 * PostgreSQL/pg error message patterns that indicate
 * a credential / authentication failure after a password rotation.
 */
const AUTH_ERROR_PATTERNS = [
  /password authentication failed/i,
  /authentication failed/i,
  /SASL.*authentication/i,
];

module.exports = {
  DEFAULT_CACHE_TTL_MS,
  RETRY_CONFIG,
  AUTH_ERROR_PATTERNS,
};
