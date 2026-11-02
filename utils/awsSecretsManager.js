const {
  SecretsManagerClient,
  GetSecretValueCommand,
  DescribeSecretCommand,
} = require('@aws-sdk/client-secrets-manager');

const config = require('config');

const {getCurrentTimeInSeconds} = require('./dateUtils');

const {
  DEFAULT_CACHE_TTL_MS,
  RETRY_CONFIG,
} = require('../constants/secretsManagerConstants');
const logger = require('../middleware/loggerMiddleware');

// ---------------------------------------------------------------------------
// Cache & in-flight deduplication
// ---------------------------------------------------------------------------

/**
 * secretCache stores: { value, expireTime }
 * Only one Map is used so all mutations are synchronous and therefore
 * race-condition-free inside a single Node.js event-loop tick.
 */
const secretCache = new Map();

/**
 * inFlightRequests prevents multiple simultaneous AWS API calls for the same
 * secret (thundering-herd / race condition protection).
 * While a fetch is in progress the Promise is stored here; subsequent callers
 * simply await the same Promise instead of launching a new request.
 */
const inFlightRequests = new Map();

/**
 * latestFetchTokens guards secretCache writes against stale in-flight promises.
 * Each new fetch (including forceRefresh) registers a fresh Symbol token.
 * Only the fetch whose token is still current is allowed to populate the cache,
 * preventing a slow pre-rotation / pre-invalidation request from silently
 * overwriting a fresher value written by a forceRefresh or a post-invalidation fetch.
 */
const latestFetchTokens = new Map();

// ---------------------------------------------------------------------------
// AWS client (singleton)
// ---------------------------------------------------------------------------

let secretsManagerClient;

function getSecretsManagerClient() {
  if (!secretsManagerClient) {
    secretsManagerClient = new SecretsManagerClient({
      region: process.env.AWS_REGION,
    });
  }

  return secretsManagerClient;
}

// ---------------------------------------------------------------------------
// Retry with exponential back-off
// ---------------------------------------------------------------------------

/**
 * Retry an async function with exponential back-off.
 * @param {Function} fn - Async function to retry
 * @param {Object} opts
 * @param {number} opts.maxAttempts  - Total attempts (default 3)
 * @param {number} opts.baseDelayMs - Base delay in ms (default 200)
 * @param {string} opts.secretName  - Used only for logging context
 */
async function withExponentialBackoff({
  fn,
  maxAttempts = RETRY_CONFIG.maxAttempts,
  baseDelayMs = RETRY_CONFIG.baseDelayMs,
  secretName = '',
}) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxAttempts) {
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1); // 200 ms, 400 ms, 800 ms …
        // eslint-disable-next-line local-rules/enforce-single-object-param
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Core fetch (single AWS API call, no cache logic)
// ---------------------------------------------------------------------------

async function fetchSecretFromAWS({secretName}) {
  const client = getSecretsManagerClient();

  const command = new GetSecretValueCommand({SecretId: secretName});
  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error('SecretBinary is not supported, use SecretString');
  }

  try {
    return JSON.parse(response.SecretString);
  } catch (parseError) {
    throw new Error(
      `Failed to parse secret '${secretName}' as JSON: ${parseError.message}`
    );
  }
}

// ---------------------------------------------------------------------------
// Cache TTL resolution (prefers AWS rotation schedule → config → constant)
// ---------------------------------------------------------------------------

/**
 * Determine how long a secret should be cached.  Priority:
 *  1. AWS DescribeSecret → RotationRules.AutomaticallyAfterDays → convert to ms / 2
 *     (half the rotation window ensures we refresh well before the next rotation)
 *  2. config key  secretsManager.cacheTtlMs  (set per environment)
 *  3. DEFAULT_CACHE_TTL_MS  constant (1 h)
 *
 * DescribeSecret failures are non-fatal; we simply fall through to option 2 or 3.
 */
async function resolveCacheTtlMs({secretName}) {
  try {
    const client = getSecretsManagerClient();

    const desc = await client.send(
      new DescribeSecretCommand({SecretId: secretName})
    );

    const days = desc?.RotationRules?.AutomaticallyAfterDays;

    if (days && days > 0) {
      // Cache for half the rotation interval so we always refresh before
      // the next rotation fires
      const ttl = Math.floor((days * 24 * 60 * 60 * 1000) / 2);

      return ttl;
    }
  } catch (describeError) {
    // DescribeSecret permission missing or other transient issue – not fatal
    // Fall through to config/constant default
  }

  // Fall back to config → constant
  if (config.has('secretsManager.cacheTtlMs')) {
    return config.get('secretsManager.cacheTtlMs');
  }

  return DEFAULT_CACHE_TTL_MS;
}

// ---------------------------------------------------------------------------
// Public: get secret (with cache + dedup + retry)
// ---------------------------------------------------------------------------

/**
 * Generic function to retrieve any secret from AWS Secrets Manager.
 * Supports caching, force-refresh, race-condition deduplication and retries.
 *
 * @param {string}  secretName   - The secret name/ARN in AWS Secrets Manager
 * @param {boolean} useCache     - Whether to use cached secret (default: true)
 * @param {boolean} forceRefresh - Bypass the cache and always call AWS (default: false)
 * @returns {Promise<Object>}    - Parsed secret value
 */
async function getSecretFromSecretsManager({
  secretName,
  useCache = true,
  forceRefresh = false,
}) {
  if (!secretName) {
    throw new Error(
      'secretName is required to retrieve a secret from AWS Secrets Manager'
    );
  }

  // ── Cache hit ──────────────────────────────────────────────────────────
  if (useCache && !forceRefresh && secretCache.has(secretName)) {
    const cached = secretCache.get(secretName);
    const nowMs = getCurrentTimeInSeconds() * 1000;

    if (nowMs < cached.expireTime) {
      return cached.value;
    }

    // Expired entry – remove immediately so the fetch path wins
    secretCache.delete(secretName);
  }

  // ── Deduplication: re-use an in-flight request if one exists ──────────
  // forceRefresh bypasses deduplication: a credential rotation must never be
  // held back by a stale in-flight request that was started before the rotation
  // was triggered. Awaiting the old promise would return the pre-rotation secret.
  if (!forceRefresh && inFlightRequests.has(secretName)) {
    return inFlightRequests.get(secretName);
  }

  // ── Launch a new AWS request (with retry + back-off) ──────────────────
  // Register a token so this fetch can be identified as the latest one.
  // Any older in-flight promise (e.g. a pre-rotation non-forced request) that
  // finishes after us will see a mismatched token and skip the cache write.
  const fetchToken = Symbol();
  latestFetchTokens.set(secretName, fetchToken);

  const fetchPromise = (async () => {
    const secretValue = await withExponentialBackoff({
      secretName,
      fn: () => fetchSecretFromAWS({secretName}),
    });

    // Only write to cache if no newer fetch (forceRefresh or post-invalidation)
    // has started since this one was launched.
    if (useCache && latestFetchTokens.get(secretName) === fetchToken) {
      const ttlMs = await resolveCacheTtlMs({secretName});
      const nowMs = getCurrentTimeInSeconds() * 1000;
      secretCache.set(secretName, {
        value: secretValue,
        expireTime: nowMs + ttlMs,
      });
    }

    return secretValue;
  })()
    .catch((error) => {
      logger.error({
        message: 'AWS Secrets Manager secret fetch failed',
        secretName,
        error: error.message,
      });
      throw error;
    })
    .finally(() => {
      // Only remove our own entry – a forceRefresh call may have already
      // replaced it with a newer promise, and we must not evict that.
      if (inFlightRequests.get(secretName) === fetchPromise) {
        inFlightRequests.delete(secretName);
      }
    });

  inFlightRequests.set(secretName, fetchPromise);

  return fetchPromise;
}

// ---------------------------------------------------------------------------
// Public: cache invalidation
// ---------------------------------------------------------------------------

/**
 * Manually invalidate the cached value for a specific secret.
 * Call this when an authentication failure signals that the cached
 * credentials are stale and a rotation has already occurred in AWS.
 *
 * @param {string} secretName
 */
function invalidateSecretCache({secretName} = {}) {
  if (!secretName) return;

  secretCache.delete(secretName);

  // Retire the token so any in-flight fetch that was launched before this
  // invalidation call cannot write its stale value back into the cache.
  latestFetchTokens.delete(secretName);
}

/**
 * Invalidate all cached secrets (useful on startup or a full rotation event).
 */
function invalidateAllSecretCache() {
  secretCache.clear();

  // Retire all tokens so no in-flight fetch can write stale data back.
  latestFetchTokens.clear();
}

// ---------------------------------------------------------------------------
// RDS helper
// ---------------------------------------------------------------------------

/**
 * Get RDS credentials from AWS Secrets Manager.
 * Combines the secret with host/port/dbname parsed from DATABASE_URL.
 *
 * @param {string}  secretName
 * @param {boolean} forceRefresh - Bypass cache (useful during credential rotation)
 * @returns {Promise<Object>}
 */
async function getRDSCredentialsFromSecretsManager({
  secretName,
  forceRefresh = false,
}) {
  const secretValue = await getSecretFromSecretsManager({
    secretName,
    forceRefresh,
  });

  // Extract host, port and dbname from the static DATABASE_URL (which may
  // contain placeholder credentials – only the structural parts matter here)
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL environment variable is required to extract host and database name'
    );
  }

  // Parse URL to extract host, port, and database name
  // Works with both: placeholder:placeholder@host and real:credentials@host formats
  const urlMatch = databaseUrl.match(
    /postgresql:\/\/(?:[^@]+@)?([^/:]+):(\d+)\/([^?]+)/
  );

  if (!urlMatch) {
    throw new Error(
      'Could not parse DATABASE_URL to extract host and database name.'
    );
  }

  return {
    username: secretValue.username,
    password: secretValue.password,
    host: urlMatch[1],
    port: parseInt(urlMatch[2], 10),
    dbname: urlMatch[3],
  };
}

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

/**
 * Build DATABASE_URL from a credentials object.
 * @param {Object} credentials
 * @returns {string}
 */
function buildDatabaseURL({credentials}) {
  const {username, password, host, port, dbname} = credentials;

  if (!username || !password || !host || !port || !dbname) {
    throw new Error(
      'Missing required database credentials: username, password, host, port, or dbname'
    );
  }

  // URL encode password to handle special characters
  const encodedPassword = encodeURIComponent(password);

  // Get SSL and timeout settings from config
  let sslAndTimeoutSettings;
  if (config.has('databaseSslTimeoutOptions')) {
    sslAndTimeoutSettings = config.get('databaseSslTimeoutOptions');
  }

  const queryString = sslAndTimeoutSettings ? `?${sslAndTimeoutSettings}` : '';

  return `postgresql://${username}:${encodedPassword}@${host}:${port}/${dbname}${queryString}`;
}

// ---------------------------------------------------------------------------
// Resolve database URL
// ---------------------------------------------------------------------------

/**
 * Resolve the final database URL from environment or AWS Secrets Manager.
 *
 * @param {boolean} forceRefresh - Force a fresh secret fetch from AWS (default: false).
 *   Pass `true` when handling a credential-rotation scenario.
 * @returns {Promise<string>}
 */
async function resolveDatabaseUrl({forceRefresh = false} = {}) {
  const secretName = process.env.RDS_SECRET_NAME;

  if (secretName) {
    const credentials = await getRDSCredentialsFromSecretsManager({
      secretName,
      forceRefresh,
    });

    return buildDatabaseURL({credentials});
  }

  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    throw new Error(
      'Database URL could not be resolved: neither RDS_SECRET_NAME nor DATABASE_URL is set'
    );
  }

  return dbUrl;
}

module.exports = {
  getSecretFromSecretsManager,
  getRDSCredentialsFromSecretsManager,
  buildDatabaseURL,
  resolveDatabaseUrl,
  invalidateSecretCache,
  invalidateAllSecretCache,
};
