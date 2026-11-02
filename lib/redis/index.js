const {once} = require('events');

const config = require('config');

const REDIS_CONNECT_TIMEOUT_MS = 30000;

const Redis = require('ioredis');

// Import the logger module directly (not via the middleware index) — the
// middleware index participates in a require cycle with services → bullMQ →
// redis, which would hand back an incomplete {} here and leave logger
// undefined when the connection events fire.
const logger = require('../../middleware/loggerMiddleware');

// Options shared by both the single-node and cluster clients.
// `tls: {}` is required when the server (e.g. ElastiCache/Valkey with
// in-transit encryption) only accepts TLS connections. Enabled via REDIS_TLS
// so local plaintext Redis keeps working.
const redisOptions = {
  password: config.get(`redisPassword`),
  username: config.get(`redisUsername`),
  maxRetriesPerRequest: null, // Required by BullMQ
};

if (config.get('redisTls')) redisOptions.tls = {};

// ElastiCache/Valkey "cluster mode enabled" needs the ioredis Cluster client:
// the single-node client can't follow the MOVED/ASK redirects a sharded
// cluster returns. The config endpoint is the only seed node needed — ioredis
// discovers the rest. `dnsLookup` passthrough is required for ElastiCache,
// whose nodes are advertised by hostnames that must be resolved as-is for TLS
// SNI to line up with the certificate.
const buildRedisConnection = () => {
  const host = config.get(`redisHost`);
  const port = parseInt(config.get(`redisPort`));

  if (config.get('redisCluster')) {
    return new Redis.Cluster([{host, port}], {
      dnsLookup: (address, callback) => callback(null, address),
      redisOptions,
    });
  }

  return new Redis(Object.assign({host, port}, redisOptions));
};

const redisConnection = buildRedisConnection();

redisConnection.on('connect', () => logger.info('Redis connected'));
redisConnection.on('error', (error) =>
  logger.error('Redis connection error', {
    error: error.message,
    code: error.code,
  })
);

const connectRedis = async () => {
  if (redisConnection.status === 'ready') return;

  while (redisConnection.status !== 'end') {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REDIS_CONNECT_TIMEOUT_MS);
    try {
      await once(redisConnection, 'ready', {signal: ac.signal});
      clearTimeout(timer);

      return;
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError')
        throw new Error('Redis connection timeout');
      if (redisConnection.status === 'end')
        throw new Error('Redis connection ended permanently');

      // transient ioredis error during reconnect — continue waiting
    }
  }

  throw new Error('Redis connection ended permanently');
};

module.exports = {redisConnection, connectRedis};
