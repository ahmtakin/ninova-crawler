/**
 * Redis connection manager — two separate instances.
 * - queueRedis: for BullMQ job queue management
 * - cacheRedis: for visited URL sets and search result caching
 */

const Redis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

let queueRedis = null;
let cacheRedis = null;

/**
 * Initialize both Redis connections.
 */
async function connect() {
  if (queueRedis && cacheRedis) {
    return;
  }

  try {
    // Redis for BullMQ job queue
    queueRedis = new Redis(config.redisQueueUrl, {
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

    // Wait for connections
    await Promise.all([
      new Promise((resolve, reject) => {
        queueRedis.on('ready', resolve);
        queueRedis.on('error', reject);
      }),
      new Promise((resolve, reject) => {
        cacheRedis.on('ready', resolve);
        cacheRedis.on('error', reject);
      })
    ]);

    logger.info('Both Redis instances connected successfully');

  } catch (error) {
    logger.error('Failed to connect to Redis', { error: error.message });
    throw error;
  }
}

/**
 * @returns {import('ioredis').Redis} Redis client for job queue
 */
function getQueueRedis() {
  if (!queueRedis) throw new Error('Queue Redis not connected');
  return queueRedis;
}

/**
 * @returns {import('ioredis').Redis} Redis client for caching
 */
function getCacheRedis() {
  if (!cacheRedis) throw new Error('Cache Redis not connected');
  return cacheRedis;
}

/**
 * Close all Redis connections gracefully.
 */
async function closeAll() {
  const closePromises = [];

  if (queueRedis) {
    closePromises.push(
      queueRedis.quit().catch(err => {
        logger.error('Error closing queue Redis connection', { error: err.message });
      })
    );
  }

  if (cacheRedis) {
    closePromises.push(
      cacheRedis.quit().catch(err => {
        logger.error('Error closing cache Redis connection', { error: err.message });
      })
    );
  }

  await Promise.all(closePromises);

  queueRedis = null;
  cacheRedis = null;

  logger.info('All Redis connections closed');
}

module.exports = { connect, getQueueRedis, getCacheRedis, closeAll };
