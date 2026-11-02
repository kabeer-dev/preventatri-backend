/**
 * Database Connection Manager for Prisma 7
 *
 * This module manages Prisma Client connection lifecycle and provides:
 * - Dynamic database URL configuration (supporting AWS Secrets Manager)
 * - Automatic retry on transient connection failures
 * - Health check endpoint support
 *
 * Prisma 7 Changes:
 * - Uses @prisma/adapter-pg driver adapter (now required)
 * - Import from generated path instead of @prisma/client
 * - Uses $extends() for middleware (soft-delete, password hashing)
 */

const {PrismaPg} = require('@prisma/adapter-pg');

const config = require('config');

const {
  resolveDatabaseUrl,
  invalidateSecretCache,
} = require('./awsSecretsManager');
const {createExtendedPrismaClient} = require('./prismaExtended');

const {PRISMA_AUTH_ERROR_CODE} = require('../constants/errorsConstants');
const {AUTH_ERROR_PATTERNS} = require('../constants/secretsManagerConstants');
const {PrismaClient} = require('../generated/prisma/client');
const logger = require('../middleware/loggerMiddleware');

let prismaClient;
let extendedPrismaClient;
let currentDatabaseUrl = process.env.DATABASE_URL;
let rotationInFlightPromise;

function isAuthError({error}) {
  if (error?.code === PRISMA_AUTH_ERROR_CODE) return true;

  const msg = error?.message || '';

  return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(msg));
}

/**
 * Test database connection by running SELECT 1.
 * Throws if connection fails.
 */
async function verifyDatabaseConnection({client}) {
  await client.$queryRaw`SELECT 1`;
}

async function disconnectClientQuietly({client}) {
  if (!client) return;

  try {
    await client.$disconnect();
  } catch {
    // Ignore disconnect errors during cleanup
  }
}

function createPrismaClients({databaseUrl}) {
  const logQueries = config.get('database.monitoring.logQueries');

  const prismaLogLevel = logQueries
    ? ['query', 'error', 'warn']
    : ['error', 'warn'];

  const adapter = new PrismaPg({connectionString: databaseUrl});

  const basePrisma = new PrismaClient({
    adapter,
    log: prismaLogLevel,
    errorFormat: 'pretty',
  });

  const extendedPrisma = createExtendedPrismaClient({basePrisma});

  return {basePrisma, extendedPrisma};
}

/**
 * Initialize Prisma Client with driver adapter and extensions
 */
function initializePrismaClient() {
  if (extendedPrismaClient) {
    return extendedPrismaClient;
  }

  const {basePrisma, extendedPrisma} = createPrismaClients({
    databaseUrl: currentDatabaseUrl,
  });
  prismaClient = basePrisma;
  extendedPrismaClient = extendedPrisma;

  return extendedPrismaClient;
}

/**
 * Connect to database with minimal retry logic
 * Retries only handle transient network issues; won't fix credential/IP issues
 */
async function connectDatabase({maxRetries = 3, retryDelay = 1000} = {}) {
  let attempt = 0;
  currentDatabaseUrl = await resolveDatabaseUrl();

  while (attempt < maxRetries) {
    try {
      const client = initializePrismaClient();
      await verifyDatabaseConnection({client});
      logger.info('Database connected');

      return client;
    } catch (error) {
      attempt++;

      if (attempt >= maxRetries) {
        logger.error(`Database connection failed: ${error.message}`);
        throw error;
      }

      logger.warn(`Connection attempt ${attempt} failed. Retrying...`);

      // Reset the clients to force a fresh connection attempt on retry
      await disconnectClientQuietly({client: prismaClient});
      prismaClient = null;
      extendedPrismaClient = null;
      // eslint-disable-next-line local-rules/enforce-single-object-param
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
}

function assertInitialized({client}) {
  if (!client) {
    throw new Error(
      'Prisma Client not initialized. Call connectDatabase() first.'
    );
  }
}

/**
 * Tear down the current Prisma client and rebuild it using freshly-fetched
 * credentials from AWS Secrets Manager.
 * Called automatically by catchAsyncMiddleware when an auth error is detected.
 */
async function rotateAndReconnect() {
  if (rotationInFlightPromise) {
    logger.info({
      message:
        'Credential rotation already in progress. Waiting for completion',
    });

    return rotationInFlightPromise;
  }

  const secretName = process.env.RDS_SECRET_NAME;

  logger.warn({
    message: 'Database auth error detected – rotating credentials',
    hasRdsSecret: Boolean(secretName),
  });

  rotationInFlightPromise = (async () => {
    // 1. Invalidate the stale cached secret
    if (secretName) {
      invalidateSecretCache({secretName});
    }

    const previousPrismaClient = prismaClient;

    // 2. Resolve fresh URL (forces new AWS API call)
    const nextDatabaseUrl = await resolveDatabaseUrl({
      forceRefresh: Boolean(secretName),
    });

    // 3. Create and verify a fresh client before swapping globals
    const {basePrisma, extendedPrisma} = createPrismaClients({
      databaseUrl: nextDatabaseUrl,
    });

    try {
      await verifyDatabaseConnection({client: extendedPrisma});
    } catch (error) {
      await disconnectClientQuietly({client: basePrisma});
      throw error;
    }

    // 4. Atomically swap to the verified client, then clean up old pool
    currentDatabaseUrl = nextDatabaseUrl;
    prismaClient = basePrisma;
    extendedPrismaClient = extendedPrisma;
    await disconnectClientQuietly({client: previousPrismaClient});

    logger.info({
      message: 'Database reconnected after credential rotation',
    });

    return extendedPrisma;
  })();

  try {
    return await rotationInFlightPromise;
  } finally {
    rotationInFlightPromise = null;
  }
}

/**
 * Get Prisma Client instance (with extensions applied)
 */
function getPrismaClient() {
  assertInitialized({client: extendedPrismaClient});

  return extendedPrismaClient;
}

/**
 * Get the base Prisma Client instance (without extensions)
 * Use this for internal operations that need to bypass middleware
 */
function getBasePrismaClient() {
  assertInitialized({client: prismaClient});

  return prismaClient;
}

/**
 * Health check for database connection
 */
async function healthCheck() {
  try {
    const client = getPrismaClient();
    await client.$queryRaw`SELECT 1`;

    return {
      healthy: true,
      message: 'Database connection is healthy',
    };
  } catch (error) {
    const config = require('config');
    logger.error('Database health check failed:', error);

    // Sanitize error message for production to prevent information leakage
    const isProd = config.get('envVariables.prod') === process.env.NODE_ENV;

    const message = isProd
      ? 'Database connection failed'
      : `Database connection failed: ${error.message}`;

    return {
      healthy: false,
      message,
    };
  }
}

/**
 * Graceful shutdown - close pool and prisma connections
 */
async function disconnect() {
  try {
    if (prismaClient) await prismaClient.$disconnect();
    prismaClient = null;
    extendedPrismaClient = null;

    logger.info('Database connections closed');
  } catch (error) {
    logger.error('Error during database disconnect:', error);
  }
}

module.exports = {
  initializePrismaClient,
  connectDatabase,
  getPrismaClient,
  getBasePrismaClient,
  healthCheck,
  disconnect,
  isAuthError,
  rotateAndReconnect,
};
