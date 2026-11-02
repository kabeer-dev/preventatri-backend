/**
 * Unit tests for the refactored AWS Secrets Manager integration.
 *
 * What is tested:
 *  1.  Cache hit  – AWS is NOT called a second time within TTL
 *  2.  Cache expiry – AWS IS called again after TTL lapses
 *  3.  forceRefresh – bypasses a valid cache entry
 *  4.  invalidateSecretCache – removes a specific entry
 *  5.  invalidateAllSecretCache – clears every entry
 *  6.  Deduplication (thread-safety) – concurrent callers share one in-flight request
 *  7.  Retry with back-off – AWS failures are retried before ultimately throwing
 *  8.  Stale-cache-after-auth-failure flow – invalidate → refetch → new value
 *  9.  resolveDatabaseUrl with forceRefresh
 *  10. buildDatabaseURL happy-path and missing-field guard
 *  11. isAuthError detection (via databaseConnectionManager)
 *  12. catchAsyncMiddleware – auto-retry on auth error, no retry on other errors
 */

'use strict';

/* -----------------------------------------------------------------------
 * Jest module mocking MUST be declared before any require() calls.
 * We mock the entire @aws-sdk/client-secrets-manager package so no real
 * network call is ever made during the tests.
 * --------------------------------------------------------------------- */
jest.mock('@aws-sdk/client-secrets-manager', () => {
  const mockSend = jest.fn();

  // Mark commands so mockSend can distinguish between GetSecretValue and DescribeSecret
  const GetSecretValueCommand = jest.fn((args) => ({
    ...args,
    __commandType: 'GetSecretValue',
  }));
  const DescribeSecretCommand = jest.fn((args) => ({
    ...args,
    __commandType: 'DescribeSecret',
  }));

  const SecretsManagerClient = jest.fn(() => ({send: mockSend}));

  return {
    SecretsManagerClient,
    GetSecretValueCommand,
    DescribeSecretCommand,
    __mockSend: mockSend,
  };
});

/* Mock config so tests don't need the full config file tree */
jest.mock('config', () => ({
  has: () => false,
  get: () => undefined,
}));

/* Mock logger to keep test output clean */
jest.mock('../../middleware/loggerMiddleware', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

/* -----------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------- */
const {__mockSend} = require('@aws-sdk/client-secrets-manager');

/** Build a valid AWS GetSecretValue response for a given JSON object */
function awsResponse(value) {
  return {SecretString: JSON.stringify(value)};
}

/** Count how many times GetSecretValueCommand was called (exclude DescribeSecret) */
function getSecretValueCallCount() {
  return __mockSend.mock.calls.filter(
    (call) => call[0]?.__commandType !== 'DescribeSecret'
  ).length;
}

/** Advance time so a cached entry ages past DEFAULT_CACHE_TTL_MS (1 hour = 3 600 000 ms) */
const {
  DEFAULT_CACHE_TTL_MS,
} = require('../../constants/secretsManagerConstants');
const CACHE_DURATION_MS = DEFAULT_CACHE_TTL_MS;

/* -----------------------------------------------------------------------
 * Re-import the module under test AFTER mocks are set up.
 * We use jest.isolateModules to get a clean module instance (fresh cache)
 * in each test that needs it.
 * --------------------------------------------------------------------- */

describe('awsSecretsManager', () => {
  let getSecretFromSecretsManager;
  let invalidateSecretCache;
  let invalidateAllSecretCache;
  let resolveDatabaseUrl;
  let buildDatabaseURL;

  beforeEach(() => {
    jest.useFakeTimers();
    __mockSend.mockClear(); // Use mockClear instead of mockReset

    /* Isolate module so the in-memory cache starts empty for each test */
    jest.isolateModules(() => {
      const mod = require('../../utils/awsSecretsManager');
      getSecretFromSecretsManager = mod.getSecretFromSecretsManager;
      invalidateSecretCache = mod.invalidateSecretCache;
      invalidateAllSecretCache = mod.invalidateAllSecretCache;
      resolveDatabaseUrl = mod.resolveDatabaseUrl;
      buildDatabaseURL = mod.buildDatabaseURL;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ── 1. Cache hit ──────────────────────────────────────────────────────
  test('returns cached value and does NOT call AWS on second request within TTL', async () => {
    const secretName = 'my/secret';
    const value = {username: 'admin', password: 'secret123'};

    // Create a wrapper that routes DescribeSecret to default, GetSecretValue to test mock
    __mockSend.mockImplementation((command) => {
      if (command.__commandType === 'DescribeSecret') {
        return Promise.resolve({RotationRules: {}});
      }
      // GetSecretValue
      return Promise.resolve(awsResponse(value));
    });

    const first = await getSecretFromSecretsManager({secretName});
    const second = await getSecretFromSecretsManager({secretName});

    expect(first).toEqual(value);
    expect(second).toEqual(value);
    expect(getSecretValueCallCount()).toBe(1); // GetSecretValue called only once
  });

  // ── 2. Cache expiry ───────────────────────────────────────────────────
  test('calls AWS again after the cache TTL expires', async () => {
    const secretName = 'my/expiring-secret';
    const oldValue = {username: 'user', password: 'old'};
    const newValue = {username: 'user', password: 'new'};

    // Track calls in this test only
    let callCountThisTest = 0;
    __mockSend.mockImplementation((command) => {
      if (command.__commandType === 'DescribeSecret') {
        return Promise.resolve({RotationRules: {}});
      }
      // Track GetSecretValue calls
      callCountThisTest++;
      return Promise.resolve(
        awsResponse(callCountThisTest === 1 ? oldValue : newValue)
      );
    });

    const first = await getSecretFromSecretsManager({secretName});
    expect(first).toEqual(oldValue);

    // Advance time beyond cache TTL
    jest.advanceTimersByTime(CACHE_DURATION_MS + 1000);

    const second = await getSecretFromSecretsManager({secretName});
    expect(second).toEqual(newValue);
    expect(callCountThisTest).toBe(2); // Two GetSecretValue calls
  });

  // ── 3. forceRefresh ───────────────────────────────────────────────────
  test('forceRefresh bypasses a valid cache entry', async () => {
    const secretName = 'my/forced-refresh';
    const stale = {username: 'u', password: 'stale'};
    const fresh = {username: 'u', password: 'fresh'};

    let callCountThisTest = 0;
    __mockSend.mockImplementation((command) => {
      if (command.__commandType === 'DescribeSecret') {
        return Promise.resolve({RotationRules: {}});
      }
      callCountThisTest++;
      return Promise.resolve(
        awsResponse(callCountThisTest === 1 ? stale : fresh)
      );
    });

    await getSecretFromSecretsManager({secretName}); // fills cache
    const result = await getSecretFromSecretsManager({
      secretName,
      forceRefresh: true,
    });

    expect(result).toEqual(fresh);
    expect(callCountThisTest).toBe(2); // Initial + forceRefresh
  });

  // ── 4. invalidateSecretCache ──────────────────────────────────────────
  test('invalidateSecretCache causes the next call to hit AWS', async () => {
    const secretName = 'my/invalidated';
    const v1 = {username: 'u', password: 'v1'};
    const v2 = {username: 'u', password: 'v2'};

    // Set mock to return different values for GetSecretValue calls
    let callCountThisTest = 0;
    __mockSend.mockImplementation((command) => {
      if (command.__commandType === 'DescribeSecret') {
        return Promise.resolve({RotationRules: {}});
      }
      // GetSecretValue: increment BEFORE reading so first call === 1
      callCountThisTest++;
      return Promise.resolve(awsResponse(callCountThisTest === 1 ? v1 : v2));
    });

    await getSecretFromSecretsManager({secretName});
    invalidateSecretCache({secretName});
    const result = await getSecretFromSecretsManager({secretName});

    expect(result).toEqual(v2);
    expect(getSecretValueCallCount()).toBe(2); // Two GetSecretValue calls
  });

  // ── 5. invalidateAllSecretCache ───────────────────────────────────────
  test('invalidateAllSecretCache clears all cached secrets', async () => {
    const names = ['s/a', 's/b', 's/c'];
    const val = {username: 'u', password: 'p'};
    __mockSend.mockImplementation((command) => {
      if (command.__commandType === 'DescribeSecret') {
        return Promise.resolve({RotationRules: {}});
      }
      return Promise.resolve(awsResponse(val));
    });

    // Populate cache for all secrets
    for (const n of names) await getSecretFromSecretsManager({secretName: n});
    expect(getSecretValueCallCount()).toBe(3); // One GetSecretValue per secret

    invalidateAllSecretCache();

    // Each secret now requires a fresh AWS call
    for (const n of names) await getSecretFromSecretsManager({secretName: n});
    expect(getSecretValueCallCount()).toBe(6); // 3 initial + 3 after invalidation
  });

  // ── 6. Deduplication / thread-safety ─────────────────────────────────
  test('concurrent callers share one in-flight AWS request (deduplication)', async () => {
    const secretName = 'my/shared';
    const value = {username: 'u', password: 'p'};

    let callCountThisTest = 0;
    __mockSend.mockImplementation((command) => {
      if (command.__commandType === 'DescribeSecret') {
        return Promise.resolve({RotationRules: {}});
      }
      callCountThisTest++;
      // Simulate a promise that doesn't rely on setTimeout
      return Promise.resolve(awsResponse(value));
    });

    // All three calls should share the same in-flight promise
    const [r1, r2, r3] = await Promise.all([
      getSecretFromSecretsManager({secretName}),
      getSecretFromSecretsManager({secretName}),
      getSecretFromSecretsManager({secretName}),
    ]);

    expect(r1).toEqual(value);
    expect(r2).toEqual(value);
    expect(r3).toEqual(value);
    expect(callCountThisTest).toBe(1); // ONE GetSecretValue call, not three
  });

  test('forceRefresh bypasses an in-flight non-forced request and fetches fresh credentials', async () => {
    // Scenario: a regular (non-forced) fetch is in-flight when credential
    // rotation fires a forceRefresh call.  The forced call must NOT await the
    // stale in-flight promise – it must launch its own AWS request and return
    // the fresh secret.
    const secretName = 'my/race-secret';
    const staleCreds = {username: 'app', password: 'stale'};
    const freshCreds = {username: 'app', password: 'fresh'};

    let callCountThisTest = 0;

    // Defer the first AWS response so it is still "in-flight" when the
    // forceRefresh call arrives.
    let resolveFirstCall;
    const firstCallPromise = new Promise((res) => {
      resolveFirstCall = res;
    });

    __mockSend.mockImplementation((command) => {
      if (command.__commandType === 'DescribeSecret') {
        return Promise.resolve({RotationRules: {}});
      }

      callCountThisTest++;

      if (callCountThisTest === 1) {
        // First call: stale in-flight request – blocked until resolved below
        return firstCallPromise.then(() => awsResponse(staleCreds));
      }

      // Second call: forced refresh – returns fresh credentials immediately
      return Promise.resolve(awsResponse(freshCreds));
    });

    // Start the non-forced request (it hangs, simulating an in-flight request)
    const regularPromise = getSecretFromSecretsManager({
      secretName,
      forceRefresh: false,
    });

    // Now fire the rotation with forceRefresh=true
    const forcedPromise = getSecretFromSecretsManager({
      secretName,
      forceRefresh: true,
    });

    // Unblock the stale in-flight call
    resolveFirstCall();

    const [regularResult, forcedResult] = await Promise.all([
      regularPromise,
      forcedPromise,
    ]);

    // Regular call gets the stale result (it was already in-flight)
    expect(regularResult).toEqual(staleCreds);
    // Forced call MUST get the fresh credentials, not the stale in-flight result
    expect(forcedResult).toEqual(freshCreds);
    // Two separate AWS calls must have been made
    expect(callCountThisTest).toBe(2);
  });

  // ── 7. Retry with back-off ────────────────────────────────────────────
  // NOTE: This test verifies retry logic. In real-world usage, exponential
  // backoff times out naturally. We test with actual Promise chains here.
  test('retries up to maxAttempts on AWS failure then throws', async () => {
    const secretName = 'my/flaky';
    const awsError = new Error('ThrottlingException');

    let callCountThisTest = 0;
    // All 3 default attempts fail
    __mockSend.mockImplementation((command) => {
      if (command.__commandType === 'DescribeSecret') {
        return Promise.resolve({RotationRules: {}});
      }
      callCountThisTest++;
      // All GetSecretValue calls fail
      return Promise.reject(awsError);
    });

    // Disable fake timers for this test so backoff delays work naturally
    jest.useRealTimers();

    try {
      await getSecretFromSecretsManager({secretName});
      throw new Error('Should have thrown');
    } catch (error) {
      expect(error.message).toContain('ThrottlingException');
      expect(callCountThisTest).toBe(3); // All 3 attempts made
    }

    jest.useFakeTimers(); // Re-enable for other tests
  }, 10000);

  test('succeeds on the second attempt after a transient failure', async () => {
    const secretName = 'my/transient';
    const value = {username: 'u', password: 'ok'};

    let callCountThisTest = 0;
    __mockSend.mockImplementation((command) => {
      if (command.__commandType === 'DescribeSecret') {
        return Promise.resolve({RotationRules: {}});
      }
      callCountThisTest++;
      if (callCountThisTest === 1) {
        return Promise.reject(new Error('ServiceUnavailable'));
      }
      return Promise.resolve(awsResponse(value));
    });

    // Disable fake timers so backoff delay works naturally
    jest.useRealTimers();

    try {
      const result = await getSecretFromSecretsManager({secretName});
      expect(result).toEqual(value);
      expect(callCountThisTest).toBe(2); // 1 fail + 1 success
    } finally {
      jest.useFakeTimers(); // Re-enable for other tests
    }
  }, 10000);

  // ── 8. Stale-cache-after-auth-failure flow ───────────────────────────
  test('invalidating stale cache after an auth failure causes next call to return new creds', async () => {
    const secretName = 'my/rotated';
    const oldCreds = {username: 'app', password: 'old-password'};
    const newCreds = {username: 'app', password: 'new-password-after-rotation'};

    let callCountThisTest = 0;
    __mockSend.mockImplementation((command) => {
      if (command.__commandType === 'DescribeSecret') {
        return Promise.resolve({RotationRules: {}});
      }
      callCountThisTest++;
      return Promise.resolve(
        awsResponse(callCountThisTest === 1 ? oldCreds : newCreds)
      );
    });

    // First call – cache is primed with old creds
    const first = await getSecretFromSecretsManager({secretName});
    expect(first.password).toBe('old-password');

    // Simulate: DB query fails with auth error → middleware calls invalidateSecretCache
    invalidateSecretCache({secretName});

    // Next resolution fetches fresh secret from AWS
    const second = await getSecretFromSecretsManager({secretName});
    expect(second.password).toBe('new-password-after-rotation');
    expect(callCountThisTest).toBe(2); // Two GetSecretValue calls
  });

  // ── 9. resolveDatabaseUrl with forceRefresh ───────────────────────────
  test('resolveDatabaseUrl returns DATABASE_URL when no RDS_SECRET_NAME is set', async () => {
    const original = process.env.RDS_SECRET_NAME;
    delete process.env.RDS_SECRET_NAME;
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/mydb';

    const url = await resolveDatabaseUrl();
    expect(url).toBe('postgresql://user:pass@localhost:5432/mydb');
    expect(__mockSend).not.toHaveBeenCalled();

    process.env.RDS_SECRET_NAME = original;
  });

  test('resolveDatabaseUrl with forceRefresh calls AWS even when cache is warm', async () => {
    process.env.RDS_SECRET_NAME = 'my/rds-secret';
    process.env.DATABASE_URL =
      'postgresql://placeholder:placeholder@db-host:5432/mydb';

    const creds = {username: 'app', password: 'pass1'};
    const freshCreds = {username: 'app', password: 'pass2'};
    let callCountThisTest = 0;
    __mockSend.mockImplementation((command) => {
      if (command.__commandType === 'DescribeSecret') {
        return Promise.resolve({RotationRules: {}});
      }
      // GET 1: creds, GET 2+: freshCreds
      callCountThisTest++;
      return Promise.resolve(
        awsResponse(callCountThisTest === 1 ? creds : freshCreds)
      );
    });

    await resolveDatabaseUrl(); // warm cache
    const url = await resolveDatabaseUrl({forceRefresh: true}); // bypass cache

    expect(url).toContain('pass2');
    expect(getSecretValueCallCount()).toBe(2); // initial + forceRefresh

    delete process.env.RDS_SECRET_NAME;
  });

  // ── 10. buildDatabaseURL ──────────────────────────────────────────────
  test('buildDatabaseURL constructs a valid URL with encoded password', () => {
    const url = buildDatabaseURL({
      credentials: {
        username: 'user',
        password: 'p@$$w0rd!',
        host: 'db.example.com',
        port: 5432,
        dbname: 'myapp',
      },
    });

    expect(url).toMatch(/^postgresql:\/\//);
    expect(url).toContain(encodeURIComponent('p@$$w0rd!'));
    expect(url).toContain('db.example.com:5432/myapp');
  });

  test('buildDatabaseURL throws when a required field is missing', () => {
    expect(() =>
      buildDatabaseURL({
        credentials: {username: 'u', host: 'h', port: 5432, dbname: 'db'},
      })
    ).toThrow('Missing required database credentials');
  });
});

// ── 11. isAuthError detection ─────────────────────────────────────────────
describe('databaseConnectionManager – isAuthError', () => {
  let isAuthError;

  beforeEach(() => {
    jest.resetModules();

    jest.mock('../../utils/awsSecretsManager', () => ({
      resolveDatabaseUrl: jest
        .fn()
        .mockResolvedValue('postgresql://u:p@h:5432/db'),
      invalidateSecretCache: jest.fn(),
    }));
    jest.mock('../../utils/prismaExtended', () => ({
      createExtendedPrismaClient: jest.fn((args) => args.basePrisma),
    }));
    jest.mock('../../middleware/loggerMiddleware', () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));
    jest.mock('@prisma/adapter-pg', () => ({PrismaPg: jest.fn()}));
    jest.mock('config', () => ({
      get: jest.fn().mockReturnValue(false),
      has: jest.fn().mockReturnValue(false),
    }));
    jest.mock('../../generated/prisma/client.ts', () => ({
      PrismaClient: jest.fn().mockImplementation(() => ({
        $queryRaw: jest.fn(),
        $disconnect: jest.fn().mockResolvedValue(undefined),
      })),
    }));

    jest.isolateModules(() => {
      ({isAuthError} = require('../../utils/databaseConnectionManager'));
    });
  });

  afterEach(() => jest.clearAllMocks());

  test('detects Prisma P1000 error code', () => {
    const error = Object.assign(new Error('auth failed'), {code: 'P1000'});
    expect(isAuthError({error})).toBe(true);
  });

  test('detects "password authentication failed" message', () => {
    const error = new Error('password authentication failed for user "app"');
    expect(isAuthError({error})).toBe(true);
  });

  test('detects SASL authentication message', () => {
    const error = new Error('SASL authentication failed');
    expect(isAuthError({error})).toBe(true);
  });

  test('returns false for non-auth errors', () => {
    const error = new Error('relation "users" does not exist');
    expect(isAuthError({error})).toBe(false);
  });
});

// ── 12. catchAsyncMiddleware – auto-retry on auth error ──────────────────
describe('catchAsyncMiddleware – credential rotation auto-retry', () => {
  let catchAsyncMiddleware;
  let mockRotateAndReconnect;

  const PASSWORD_AUTH_ERROR = Object.assign(
    new Error('password authentication failed for user "app"'),
    {code: 'P1000'}
  );
  const GENERIC_ERROR = new Error('syntax error at or near "SELEKT"');

  function createMockReqRes() {
    return {
      req: {
        originalUrl: '/api/v1/users',
        method: 'GET',
        extra: {flags: {}, entities: {}, queries: {}, options: {}},
      },
      res: {},
      nextCalls: [],
      get next() {
        const calls = this.nextCalls;
        return (err) => calls.push(err === undefined ? '__next__' : err);
      },
    };
  }

  beforeEach(() => {
    jest.resetModules();

    mockRotateAndReconnect = jest.fn().mockResolvedValue(undefined);

    jest.mock('../../utils/databaseConnectionManager', () => ({
      // Inline implementation mirrors the real isAuthError logic without
      // triggering the full module load (which has side-effectful config reads).
      isAuthError: ({error}) => {
        if (error?.code === 'P1000') return true;
        const msg = error?.message || '';
        return /password authentication failed|authentication failed|SASL.*authentication/i.test(
          msg
        );
      },
      rotateAndReconnect: mockRotateAndReconnect,
    }));

    jest.mock('../../middleware/loggerMiddleware', () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    catchAsyncMiddleware = require('../../middleware/catchAsyncMiddleware');
  });

  afterEach(() => jest.clearAllMocks());

  test('non-auth errors are passed to next() without retry', async () => {
    const handler = jest.fn().mockRejectedValue(GENERIC_ERROR);
    const wrapped = catchAsyncMiddleware(handler);
    const {req, res, next} = createMockReqRes();

    await wrapped(req, res, next);

    expect(handler).toHaveBeenCalledTimes(1); // NO retry
    expect(mockRotateAndReconnect).not.toHaveBeenCalled();
  });

  test('GET: auth error rotates credentials and retries the handler once', async () => {
    const successResult = {id: 1, name: 'John'};
    const handler = jest
      .fn()
      .mockRejectedValueOnce(PASSWORD_AUTH_ERROR)
      .mockResolvedValueOnce(successResult);

    const wrapped = catchAsyncMiddleware(handler);
    const {req, res, next, nextCalls} = createMockReqRes(); // method: 'GET'

    await wrapped(req, res, next);

    expect(handler).toHaveBeenCalledTimes(2); // original + retry
    expect(mockRotateAndReconnect).toHaveBeenCalledTimes(1);
    expect(req.extra.appResponse).toEqual(successResult);
    expect(nextCalls[0]).toBe('__next__'); // next() called with no error
  });

  test('GET: if retry also fails, error is passed to next()', async () => {
    const secondError = new Error('still broken');
    const handler = jest
      .fn()
      .mockRejectedValueOnce(PASSWORD_AUTH_ERROR)
      .mockRejectedValueOnce(secondError);

    const wrapped = catchAsyncMiddleware(handler);
    const {req, res, next, nextCalls} = createMockReqRes(); // method: 'GET'

    await wrapped(req, res, next);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(mockRotateAndReconnect).toHaveBeenCalledTimes(1);
    expect(nextCalls[0]).toBe(secondError); // error passed to Express error handler
  });

  test('successful requests pass through without any rotation logic', async () => {
    const result = {id: 1};
    const handler = jest.fn().mockResolvedValue(result);

    const wrapped = catchAsyncMiddleware(handler);
    const {req, res, next, nextCalls} = createMockReqRes();

    await wrapped(req, res, next);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(mockRotateAndReconnect).not.toHaveBeenCalled();
    expect(req.extra.appResponse).toEqual(result);
    expect(nextCalls[0]).toBe('__next__');
  });

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s: auth error rotates credentials but does NOT retry the handler',
    async (method) => {
      const handler = jest.fn().mockRejectedValue(PASSWORD_AUTH_ERROR);
      const wrapped = catchAsyncMiddleware(handler);
      const {req, res, next, nextCalls} = createMockReqRes();
      req.method = method;

      await wrapped(req, res, next);

      // Handler must NOT be called a second time — avoids duplicate side effects
      expect(handler).toHaveBeenCalledTimes(1);
      // Credentials ARE rotated so the next (client-initiated) retry will work
      expect(mockRotateAndReconnect).toHaveBeenCalledTimes(1);
      // Original auth error is forwarded so the client knows to retry
      expect(nextCalls[0]).toBe(PASSWORD_AUTH_ERROR);
    }
  );
});
