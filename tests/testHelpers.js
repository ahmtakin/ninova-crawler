/**
 * Test Helper Utilities
 *
 * Provides centralized mock management for test isolation.
 */

const { mock } = require('node:test');

/**
 * Create a mock and track it for automatic restoration
 * @param {object} module - The module containing the method to mock
 * @param {string} methodName - The name of the method to mock
 * @param {function} implementation - The mock implementation
 * @returns {object} The mock object
 */
function createTrackedMock(module, methodName, implementation) {
  const mockObj = mock.method(module, methodName, implementation);
  return mockObj;
}

/**
 * Restore all provided mocks
 * Should be called in afterEach hooks
 * @param {...object} mockObjects - Mock objects to restore
 */
function restoreAllMocks(...mockObjects) {
  for (const mockObj of mockObjects) {
    if (mockObj && mockObj.mock && typeof mockObj.mock.restore === 'function') {
      try {
        mockObj.mock.restore();
      } catch (e) {
        // Ignore restore errors
      }
    }
  }
}

/**
 * Set up fresh database and Redis mocks
 * @param {object} db - The test database instance
 * @returns {object} Object containing mock references
 */
function setupDatabaseMocks(db) {
  const mongoModule = require('../src/db/mongo');
  const redisModule = require('../src/db/redis');

  const mockRedis = {
    sadd: async () => 1,
    del: async () => Promise.resolve(1),
    flushdb: async () => Promise.resolve(),
    get: async () => null,
    setex: async () => Promise.resolve(),
  };

  const getDbMock = createTrackedMock(mongoModule, 'getDb', () => db);
  const getRedisMock = createTrackedMock(redisModule, 'getCacheRedis', () => mockRedis);

  return { getDbMock, getRedisMock, mockRedis, _allMocks: [getDbMock, getRedisMock] };
}

/**
 * Set up crawlManager mocks
 * @param {object} db - The test database instance
 * @returns {object} Object containing all crawlManager mock references
 */
function setupCrawlManagerMocks(db) {
  const { COLLECTIONS } = require('../src/db/models');
  const crawlManagerModule = require('../src/crawler/crawlManager');
  const { ObjectId } = require('mongodb');

  const startCrawlMock = createTrackedMock(crawlManagerModule, 'startCrawl', async (origin, depth, config) => {
    const result = await db.collection(COLLECTIONS.CRAWL_JOBS).insertOne({
      origin,
      maxDepth: depth,
      status: 'queued',
      config: config || {},
      stats: {
        urlsQueued: 1,
        urlsProcessed: 0,
        urlsFailed: 0,
        pagesIndexed: 0,
        startedAt: null,
        completedAt: null,
        lastActivityAt: new Date()
      },
      createdAt: new Date(),
      updatedAt: new Date()
    });
    return { jobId: result.insertedId.toString() };
  });

  const getAllJobsMock = createTrackedMock(crawlManagerModule, 'getAllJobs', async () => {
    return await db.collection(COLLECTIONS.CRAWL_JOBS).find().toArray();
  });

  const getJobStatusMock = createTrackedMock(crawlManagerModule, 'getJobStatus', async (jobId) => {
    return await db.collection(COLLECTIONS.CRAWL_JOBS).findOne({ _id: new ObjectId(jobId) });
  });

  const pauseJobMock = createTrackedMock(crawlManagerModule, 'pauseJob', async (jobId) => {
    const result = await db.collection(COLLECTIONS.CRAWL_JOBS).updateOne(
      { _id: new ObjectId(jobId) },
      { $set: { status: 'paused', updatedAt: new Date() } }
    );
    return result.modifiedCount > 0;
  });

  const resumeJobMock = createTrackedMock(crawlManagerModule, 'resumeJob', async (jobId) => {
    const result = await db.collection(COLLECTIONS.CRAWL_JOBS).updateOne(
      { _id: new ObjectId(jobId) },
      { $set: { status: 'running', updatedAt: new Date() } }
    );
    return result.modifiedCount > 0;
  });

  const cancelJobMock = createTrackedMock(crawlManagerModule, 'cancelJob', async (jobId) => {
    const result = await db.collection(COLLECTIONS.CRAWL_JOBS).updateOne(
      { _id: new ObjectId(jobId) },
      { $set: { status: 'cancelled', updatedAt: new Date() } }
    );
    return result.modifiedCount > 0;
  });

  return {
    startCrawlMock,
    getAllJobsMock,
    getJobStatusMock,
    pauseJobMock,
    resumeJobMock,
    cancelJobMock,
    _allMocks: [startCrawlMock, getAllJobsMock, getJobStatusMock, pauseJobMock, resumeJobMock, cancelJobMock]
  };
}

/**
 * Set up jobLogger mock
 * @returns {object} Object containing mock logger and mock references
 */
function setupJobLoggerMock() {
  const jobLoggerModule = require('../src/crawler/jobLogger');
  const jobLoggerMock = {
    info: async () => Promise.resolve(),
    warn: async () => Promise.resolve(),
    error: async () => Promise.resolve(),
  };

  const createJobLoggerMock = createTrackedMock(jobLoggerModule, 'createJobLogger', () => jobLoggerMock);
  return { jobLoggerMock, createJobLoggerMock, _allMocks: [createJobLoggerMock] };
}

/**
 * Clear require cache for specified modules
 * @param {...string} modulePaths - Absolute paths to modules to clear
 */
function clearRequireCache(...modulePaths) {
  for (const path of modulePaths) {
    delete require.cache[path];
  }
}

module.exports = {
  createTrackedMock,
  restoreAllMocks,
  setupDatabaseMocks,
  setupCrawlManagerMocks,
  setupJobLoggerMock,
  clearRequireCache,
};
