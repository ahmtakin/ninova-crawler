/**
 * Redis connection manager.
 *
 * Manages a single Redis instance for:
 * - Visited URL sets (deduplication via SADD)
 * - Search result caching
 */

const Redis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

let cacheRedis = null;

/**
 * Initialize Redis connection.
 */
async function connect() {
  if (cacheRedis) {
    return;
  }

  try {
    // Redis for caching and visited URL tracking
    cacheRedis = new Redis(config.redisCacheUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true;
        }
        return false;
      }
    });

    // Wait for connection
    await new Promise((resolve, reject) => {
      cacheRedis.on('ready', resolve);
      cacheRedis.on('error', reject);
    });

    logger.info('Redis connected successfully');

  } catch (error) {
    logger.error('Failed to connect to Redis', { error: error.message });
    throw error;
  }
}

/**
 * @returns {import('ioredis').Redis} Redis client for caching
 */
function getCacheRedis() {
  if (!cacheRedis) throw new Error('Redis not connected');
  return cacheRedis;
}

/**
 * Close Redis connection gracefully.
 */
async function closeAll() {
  if (cacheRedis) {
    await cacheRedis.quit().catch(err => {
      logger.error('Error closing Redis connection', { error: err.message });
    });
  }

  cacheRedis = null;

  logger.info('Redis connection closed');
}

module.exports = { connect, getCacheRedis, closeAll };
