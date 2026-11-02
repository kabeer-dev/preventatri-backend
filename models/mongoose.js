const {isMainThread} = require('worker_threads');

const config = require('config');

const mongoose = require('mongoose');

const logger = require('../middleware/loggerMiddleware');

let conn;

// DEPRECATED: MongoDB connection (still active during migration) - migrating to PostgreSQL with Prisma ORM
// Dual-database support for gradual migration. See application configuration for details.

if (isMainThread) {
  mongoose.Promise = global.Promise;
  mongoose.connect(config.get(`mongoUri`));
  conn = mongoose.connection;

  conn.on('error', () => logger.error('MongoDB connection error'));

  conn.on('open', () => logger.info('Connected to MongoDB'));
}

module.exports = conn;
