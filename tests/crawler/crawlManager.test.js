/**
 * Crawl Manager Tests
 *
 * Tests the crawl job lifecycle management functions.
 * Run: node --test tests/crawler/crawlManager.test.js
 */

const { describe, it, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { setupTestDb, cleanupTestDb, closeTestDb } = require('../setup');
const { COLLECTIONS } = require('../../src/db/models');
const {
  setupDatabaseMocks,
  setupJobLoggerMock,
  restoreAllMocks,
  clearRequireCache
} = require('../testHelpers');

describe('Crawl Manager', () => {
  let db;
  let crawlManager;
  let allMocks = [];
  let createdJobIds = [];

  before(async () => {
    db = await setupTestDb();
  });

  after(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    // Track job IDs for cleanup
    createdJobIds = [];
    await cleanupTestDb();

    // Clear ALL require caches for crawler modules to prevent state leakage
    // This is critical when tests run together
    const modulesToClear = [
      '../../src/crawler/crawlManager',
      '../../src/crawler/jobLogger',
      '../../src/crawler/fetcher',
      '../../src/crawler/parser',
      '../../src/crawler/urlQueue',
      '../../src/crawler/backpressure',
      '../../src/search/indexer',
      '../../src/api/routes',
      '../../src/api/indexController',
    ];

    modulesToClear.forEach(mod => {
      delete require.cache[require.resolve(mod)];
    });

    // Set up database mocks
    const dbMocks = setupDatabaseMocks(db);
    allMocks.push(...dbMocks._allMocks);

    // Set up logger mocks
    const loggerMocks = setupJobLoggerMock();
    allMocks.push(...loggerMocks._allMocks);

    // Mock fetcher to return minimal data (no actual HTTP requests)
    const fetcherModule = require('../../src/crawler/fetcher');
    const fetchPageMock = mock.method(fetcherModule, 'fetchPage', async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: '<html><head><title>Test</title></head><body>No links</body></html>',
      finalUrl: 'https://example.com'
    }));
    allMocks.push(fetchPageMock);

    // Mock parser to return empty data (no links = no crawling)
    const parserModule = require('../../src/crawler/parser');
    mock.method(parserModule, 'extractLinks', () => []);
    mock.method(parserModule, 'extractTitle', () => 'Test');
    mock.method(parserModule, 'extractText', () => 'test');

    // Mock indexer
    const indexerModule = require('../../src/search/indexer');
    mock.method(indexerModule, 'indexPage', async () => Promise.resolve());

    // Load crawlManager after all mocks are set up
    crawlManager = require('../../src/crawler/crawlManager');
  });

  afterEach(async () => {
    // Cancel any running crawl jobs to prevent background processes from lingering
    const runningJobs = await db.collection(COLLECTIONS.CRAWL_JOBS).find({
      status: { $in: ['running', 'queued'] }
    }).toArray();

    for (const job of runningJobs) {
      try {
        await crawlManager.cancelJob(job._id.toString());
      } catch (e) {
        // Ignore errors during cleanup
      }
    }

    restoreAllMocks(...allMocks);
    allMocks = [];

    // Clear caches to prevent state leakage to other test files
    const modulesToClear = [
      '../../src/crawler/crawlManager',
      '../../src/crawler/urlQueue',
      '../../src/api/routes',
    ];

    modulesToClear.forEach(mod => {
      delete require.cache[require.resolve(mod)];
    });
  });

  describe('startCrawl()', () => {
    it('should create job document in database', async () => {
      const result = await crawlManager.startCrawl('https://example.com', 2);

      // Wait a bit for the background crawlLoop to start (even though it's mocked)
      await new Promise(resolve => setImmediate(resolve));

      const job = await db.collection(COLLECTIONS.CRAWL_JOBS).findOne({
        _id: new ObjectId(result.jobId)
      });

      assert.ok(job);
      assert.strictEqual(job.origin, 'https://example.com');
      assert.strictEqual(job.maxDepth, 2);
      assert.strictEqual(job.status, 'running');
    });

    it('should add origin URL to crawl queue', async () => {
      const result = await crawlManager.startCrawl('https://example.com', 1);

      await new Promise(resolve => setImmediate(resolve));

      const queueItem = await db.collection(COLLECTIONS.CRAWL_QUEUE).findOne({
        crawlJobId: new ObjectId(result.jobId),
        url: 'https://example.com'
      });

      assert.ok(queueItem);
      assert.strictEqual(queueItem.depth, 0);
      assert.strictEqual(queueItem.status, 'pending');
    });

    it('should return job ID and status', async () => {
      const result = await crawlManager.startCrawl('https://example.com', 2);

      assert.ok(result.jobId);
      assert.strictEqual(typeof result.jobId, 'string');
      assert.strictEqual(result.status, 'running');
    });

    it('should set job status to running', async () => {
      const result = await crawlManager.startCrawl('https://example.com', 1);

      await new Promise(resolve => setImmediate(resolve));

      const job = await db.collection(COLLECTIONS.CRAWL_JOBS).findOne({
        _id: new ObjectId(result.jobId)
      });

      assert.strictEqual(job.status, 'running');
    });

    it('should initialize job stats', async () => {
      const result = await crawlManager.startCrawl('https://example.com', 2);

      await new Promise(resolve => setImmediate(resolve));

      const job = await db.collection(COLLECTIONS.CRAWL_JOBS).findOne({
        _id: new ObjectId(result.jobId)
      });

      assert.ok(job.stats);
      assert.strictEqual(typeof job.stats.urlsQueued, 'number');
      assert.strictEqual(typeof job.stats.urlsProcessed, 'number');
      assert.strictEqual(typeof job.stats.urlsFailed, 'number');
      assert.ok(job.stats.startedAt);
    });

    it('should use default config when not provided', async () => {
      const result = await crawlManager.startCrawl('https://example.com', 1);

      await new Promise(resolve => setImmediate(resolve));

      const job = await db.collection(COLLECTIONS.CRAWL_JOBS).findOne({
        _id: new ObjectId(result.jobId)
      });

      assert.ok(job.config);
      assert.ok(typeof job.config.maxQueueDepth === 'number');
      assert.ok(typeof job.config.maxRequestsPerSecond === 'number');
      assert.ok(typeof job.config.maxConcurrentFetches === 'number');
    });

    it('should throw error for invalid URL', async () => {
      await assert.rejects(
        async () => {
          await crawlManager.startCrawl('not-a-valid-url', 1);
        },
        /Invalid origin URL/i
      );
    });

    it('should throw error for invalid depth', async () => {
      await assert.rejects(
        async () => {
          await crawlManager.startCrawl('https://example.com', 0);
        },
        /Depth must be between/
      );
    });

    it('should normalize origin URL', async () => {
      const result = await crawlManager.startCrawl('https://example.com/', 1);

      await new Promise(resolve => setImmediate(resolve));

      const job = await db.collection(COLLECTIONS.CRAWL_JOBS).findOne({
        _id: new ObjectId(result.jobId)
      });

      // URL should be normalized (trailing slash removed)
      assert.strictEqual(job.origin, 'https://example.com');
    });
  });

  describe('getJobStatus()', () => {
    it('should return job status for valid job ID', async () => {
      const insertResult = await db.collection(COLLECTIONS.CRAWL_JOBS).insertOne({
        origin: 'https://example.com',
        maxDepth: 2,
        status: 'running',
        config: { maxQueueDepth: 1000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
        stats: { urlsQueued: 10, urlsProcessed: 5, urlsFailed: 0, pagesIndexed: 4, startedAt: new Date() },
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const status = await crawlManager.getJobStatus(insertResult.insertedId.toString());

      assert.ok(status);
      assert.strictEqual(status._id, insertResult.insertedId.toString());
      assert.strictEqual(status.origin, 'https://example.com');
      assert.strictEqual(status.status, 'running');
    });

    it('should return null for non-existent job', async () => {
      const fakeId = new ObjectId().toString();
      const status = await crawlManager.getJobStatus(fakeId);

      assert.strictEqual(status, null);
    });

    it('should return null for invalid ObjectId format', async () => {
      const status = await crawlManager.getJobStatus('not-an-objectid');

      assert.strictEqual(status, null);
    });
  });

  describe('getAllJobs()', () => {
    beforeEach(async () => {
      await db.collection(COLLECTIONS.CRAWL_JOBS).insertMany([
        {
          origin: 'https://example.com',
          maxDepth: 2,
          status: 'running',
          config: { maxQueueDepth: 1000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
          stats: { urlsQueued: 10, urlsProcessed: 5, urlsFailed: 0, pagesIndexed: 4 },
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date()
        },
        {
          origin: 'https://example.org',
          maxDepth: 1,
          status: 'completed',
          config: { maxQueueDepth: 1000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
          stats: { urlsQueued: 5, urlsProcessed: 5, urlsFailed: 0, pagesIndexed: 5 },
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date()
        },
        {
          origin: 'https://example.net',
          maxDepth: 3,
          status: 'queued',
          config: { maxQueueDepth: 1000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
          stats: { urlsQueued: 0, urlsProcessed: 0, urlsFailed: 0, pagesIndexed: 0 },
          createdAt: new Date('2024-01-03'),
          updatedAt: new Date()
        }
      ]);
    });

    it('should return all jobs', async () => {
      const jobs = await crawlManager.getAllJobs();

      assert.strictEqual(jobs.length, 3);
    });

    it('should return jobs with _id as string', async () => {
      const jobs = await crawlManager.getAllJobs();

      assert.strictEqual(typeof jobs[0]._id, 'string');
    });

    it('should return jobs sorted by creation time descending', async () => {
      const jobs = await crawlManager.getAllJobs();

      assert.strictEqual(jobs[0].origin, 'https://example.net');
      assert.strictEqual(jobs[1].origin, 'https://example.com');
      assert.strictEqual(jobs[2].origin, 'https://example.org');
    });

    it('should return empty array when no jobs exist', async () => {
      await cleanupTestDb();
      const jobs = await crawlManager.getAllJobs();

      assert.deepStrictEqual(jobs, []);
    });
  });

  describe('pauseJob()', () => {
    it('should set job status to paused', async () => {
      const result = await db.collection(COLLECTIONS.CRAWL_JOBS).insertOne({
        origin: 'https://example.com',
        maxDepth: 2,
        status: 'running',
        config: { maxQueueDepth: 1000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
        stats: { urlsQueued: 10, urlsProcessed: 5, urlsFailed: 0, pagesIndexed: 4 },
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await crawlManager.pauseJob(result.insertedId.toString());

      const job = await db.collection(COLLECTIONS.CRAWL_JOBS).findOne({
        _id: result.insertedId
      });

      assert.strictEqual(job.status, 'paused');
    });

    it('should update updatedAt timestamp', async () => {
      const originalTime = new Date('2024-01-01');
      const result = await db.collection(COLLECTIONS.CRAWL_JOBS).insertOne({
        origin: 'https://example.com',
        maxDepth: 2,
        status: 'running',
        config: { maxQueueDepth: 1000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
        stats: { urlsQueued: 10, urlsProcessed: 5, urlsFailed: 0, pagesIndexed: 4 },
        createdAt: originalTime,
        updatedAt: originalTime
      });

      await crawlManager.pauseJob(result.insertedId.toString());

      const job = await db.collection(COLLECTIONS.CRAWL_JOBS).findOne({
        _id: result.insertedId
      });

      assert.ok(job.updatedAt > originalTime);
    });

    it('should throw error for invalid job ID', async () => {
      await assert.rejects(
        async () => {
          await crawlManager.pauseJob('invalid-id');
        }
      );
    });
  });

  describe('resumeJob()', () => {
    it('should set job status to running', async () => {
      const result = await db.collection(COLLECTIONS.CRAWL_JOBS).insertOne({
        origin: 'https://example.com',
        maxDepth: 2,
        status: 'paused',
        config: { maxQueueDepth: 1000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
        stats: { urlsQueued: 10, urlsProcessed: 5, urlsFailed: 0, pagesIndexed: 4, startedAt: new Date() },
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await crawlManager.resumeJob(result.insertedId.toString());

      await new Promise(resolve => setImmediate(resolve));

      const job = await db.collection(COLLECTIONS.CRAWL_JOBS).findOne({
        _id: result.insertedId
      });

      assert.strictEqual(job.status, 'running');
    });

    it('should throw error for non-existent job', async () => {
      const fakeId = new ObjectId().toString();

      await assert.rejects(
        async () => {
          await crawlManager.resumeJob(fakeId);
        },
        /Job not found/i
      );
    });
  });

  describe('cancelJob()', () => {
    it('should set job status to cancelled', async () => {
      const result = await db.collection(COLLECTIONS.CRAWL_JOBS).insertOne({
        origin: 'https://example.com',
        maxDepth: 2,
        status: 'running',
        config: { maxQueueDepth: 1000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
        stats: { urlsQueued: 10, urlsProcessed: 5, urlsFailed: 0, pagesIndexed: 4, startedAt: new Date() },
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await crawlManager.cancelJob(result.insertedId.toString());

      const job = await db.collection(COLLECTIONS.CRAWL_JOBS).findOne({
        _id: result.insertedId
      });

      assert.strictEqual(job.status, 'cancelled');
    });

    it('should update updatedAt timestamp', async () => {
      const originalTime = new Date('2024-01-01');
      const result = await db.collection(COLLECTIONS.CRAWL_JOBS).insertOne({
        origin: 'https://example.com',
        maxDepth: 2,
        status: 'running',
        config: { maxQueueDepth: 1000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
        stats: { urlsQueued: 10, urlsProcessed: 5, urlsFailed: 0, pagesIndexed: 4, startedAt: new Date() },
        createdAt: originalTime,
        updatedAt: originalTime
      });

      await crawlManager.cancelJob(result.insertedId.toString());

      const job = await db.collection(COLLECTIONS.CRAWL_JOBS).findOne({
        _id: result.insertedId
      });

      assert.ok(job.updatedAt > originalTime);
    });
  });

  describe('getSystemStatus()', () => {
    beforeEach(async () => {
      await db.collection(COLLECTIONS.CRAWL_JOBS).insertMany([
        {
          origin: 'https://example.com',
          maxDepth: 2,
          status: 'running',
          config: { maxQueueDepth: 1000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
          stats: { urlsQueued: 10, urlsProcessed: 5, urlsFailed: 0, pagesIndexed: 4, startedAt: new Date() },
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          origin: 'https://example.org',
          maxDepth: 1,
          status: 'completed',
          config: { maxQueueDepth: 1000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
          stats: { urlsQueued: 5, urlsProcessed: 5, urlsFailed: 0, pagesIndexed: 5 },
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]);

      // Add some queue items
      await db.collection(COLLECTIONS.CRAWL_QUEUE).insertMany([
        { crawlJobId: new ObjectId(), url: 'https://example.com/1', depth: 0, status: 'pending', createdAt: new Date() },
        { crawlJobId: new ObjectId(), url: 'https://example.com/2', depth: 0, status: 'processing', createdAt: new Date() },
        { crawlJobId: new ObjectId(), url: 'https://example.com/3', depth: 0, status: 'done', createdAt: new Date() },
      ]);
    });

    it('should return system status with jobs array', async () => {
      const status = await crawlManager.getSystemStatus();

      assert.ok(status.jobs);
      assert.ok(Array.isArray(status.jobs));
      assert.strictEqual(status.jobs.length, 2);
    });

    it('should return system stats', async () => {
      const status = await crawlManager.getSystemStatus();

      assert.ok(status.system);
      assert.strictEqual(typeof status.system.totalUrlsQueued, 'number');
      assert.strictEqual(typeof status.system.totalUrlsProcessed, 'number');
      assert.strictEqual(typeof status.system.activeJobs, 'number');
      assert.strictEqual(typeof status.system.totalJobs, 'number');
    });

    it('should count active jobs correctly', async () => {
      const status = await crawlManager.getSystemStatus();

      assert.strictEqual(status.system.activeJobs, 1);
    });

    it('should include timestamp', async () => {
      const status = await crawlManager.getSystemStatus();

      assert.ok(status.system.timestamp);
    });

    it('should handle empty database gracefully', async () => {
      await cleanupTestDb();
      const status = await crawlManager.getSystemStatus();

      assert.deepStrictEqual(status.jobs, []);
      assert.strictEqual(status.system.activeJobs, 0);
      assert.strictEqual(status.system.totalJobs, 0);
    });
  });
});
