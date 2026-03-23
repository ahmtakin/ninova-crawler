/**
 * Index Controller Tests
 *
 * Tests the crawl job management API endpoints.
 * Run: node --test tests/api/indexController.test.js
 */

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const request = require('supertest');

const { setupTestDb, cleanupTestDb, closeTestDb } = require('../setup');
const { COLLECTIONS } = require('../../src/db/models');
const {
  setupDatabaseMocks,
  setupCrawlManagerMocks,
  restoreAllMocks,
  clearRequireCache
} = require('../testHelpers');

describe('Index Controller API', () => {
  let db;
  let app;
  let allMocks = [];

  before(async () => {
    db = await setupTestDb();
  });

  after(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();

    // Clear require cache for modules that will be mocked
    // Note: Don't clear mongo/redis as testHelpers needs them
    clearRequireCache(
      require.resolve('../../src/crawler/crawlManager'),
      require.resolve('../../src/api/routes')
    );

    // Set up database and crawlManager mocks and collect them
    const dbMocks = setupDatabaseMocks(db);
    allMocks.push(...dbMocks._allMocks);

    const crawlManagerMocks = setupCrawlManagerMocks(db);
    allMocks.push(...crawlManagerMocks._allMocks);

    // Create fresh Express app
    const express = require('express');
    app = express();
    app.use(express.json());

    // Load routes after mocks
    const apiRoutes = require('../../src/api/routes');
    app.use('/api', apiRoutes);
  });

  afterEach(() => {
    restoreAllMocks(...allMocks);
    allMocks = [];
  });

  describe('GET /api/index', () => {
    beforeEach(async () => {
      // Insert test jobs
      await db.collection(COLLECTIONS.CRAWL_JOBS).insertMany([
        {
          origin: 'https://example.com',
          maxDepth: 2,
          status: 'queued',
          config: { maxQueueDepth: 1000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
          stats: { urlsQueued: 1, urlsProcessed: 0, urlsFailed: 0, pagesIndexed: 0, startedAt: null, completedAt: null, lastActivityAt: new Date() },
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          origin: 'https://example.org',
          maxDepth: 3,
          status: 'running',
          config: { maxQueueDepth: 10000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
          stats: { urlsQueued: 50, urlsProcessed: 25, urlsFailed: 2, pagesIndexed: 20, startedAt: new Date(), completedAt: null, lastActivityAt: new Date() },
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]);
    });

    it('should return array of all jobs', async () => {
      const response = await request(app)
        .get('/api/index');

      assert.strictEqual(response.status, 200);
      assert.ok(Array.isArray(response.body));
      assert.strictEqual(response.body.length, 2);
    });

    it('should return empty array when no jobs', async () => {
      await cleanupTestDb();

      const response = await request(app)
        .get('/api/index');

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.body, []);
    });

    it('should include required fields in each job', async () => {
      const response = await request(app)
        .get('/api/index');

      assert.strictEqual(response.status, 200);
      const job = response.body[0];

      assert.ok(job.origin);
      assert.ok(typeof job.maxDepth !== 'undefined');
      assert.ok(job.status);
      assert.ok(job.stats);
      assert.ok(job.config);
    });
  });

  describe('GET /api/index/:id', () => {
    let jobId;

    beforeEach(async () => {
      const result = await db.collection(COLLECTIONS.CRAWL_JOBS).insertOne({
        origin: 'https://example.com',
        maxDepth: 2,
        status: 'queued',
        config: { maxQueueDepth: 1000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
        stats: { urlsQueued: 1, urlsProcessed: 0, urlsFailed: 0, pagesIndexed: 0, startedAt: null, completedAt: null, lastActivityAt: new Date() },
        createdAt: new Date(),
        updatedAt: new Date()
      });
      jobId = result.insertedId.toString();
    });

    it('should return job by ID', async () => {
      const response = await request(app)
        .get(`/api/index/${jobId}`);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body._id, jobId);
      assert.strictEqual(response.body.origin, 'https://example.com');
    });

    it('should return 404 for non-existent job', async () => {
      const fakeId = new ObjectId().toString();

      const response = await request(app)
        .get(`/api/index/${fakeId}`);

      assert.strictEqual(response.status, 404);
    });

    it('should return 400 for invalid ObjectId format', async () => {
      const response = await request(app)
        .get('/api/index/invalid-id');

      assert.strictEqual(response.status, 400);
    });
  });

  describe('POST /api/index/:id/pause', () => {
    it('should pause running job', async () => {
      const result = await db.collection(COLLECTIONS.CRAWL_JOBS).insertOne({
        origin: 'https://example.com',
        maxDepth: 2,
        status: 'running',
        config: { maxQueueDepth: 1000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
        stats: { urlsQueued: 10, urlsProcessed: 5, urlsFailed: 0, pagesIndexed: 4, startedAt: new Date(), completedAt: null, lastActivityAt: new Date() },
        createdAt: new Date(),
        updatedAt: new Date()
      });
      const jobId = result.insertedId.toString();

      const response = await request(app)
        .post(`/api/index/${jobId}/pause`);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.message, 'Job paused');
      assert.strictEqual(response.body.jobId, jobId);
    });

    it('should return 400 for already paused job', async () => {
      const result = await db.collection(COLLECTIONS.CRAWL_JOBS).insertOne({
        origin: 'https://example.com',
        maxDepth: 2,
        status: 'paused',
        config: { maxQueueDepth: 1000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
        stats: { urlsQueued: 10, urlsProcessed: 5, urlsFailed: 0, pagesIndexed: 4, startedAt: new Date(), completedAt: null, lastActivityAt: new Date() },
        createdAt: new Date(),
        updatedAt: new Date()
      });
      const jobId = result.insertedId.toString();

      const response = await request(app)
        .post(`/api/index/${jobId}/pause`);

      assert.strictEqual(response.status, 400);
    });

    it('should return 404 for non-existent job', async () => {
      const fakeId = new ObjectId().toString();

      const response = await request(app)
        .post(`/api/index/${fakeId}/pause`);

      assert.strictEqual(response.status, 404);
    });
  });

  describe('POST /api/index/:id/resume', () => {
    it('should resume paused job', async () => {
      const result = await db.collection(COLLECTIONS.CRAWL_JOBS).insertOne({
        origin: 'https://example.com',
        maxDepth: 2,
        status: 'paused',
        config: { maxQueueDepth: 1000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
        stats: { urlsQueued: 10, urlsProcessed: 5, urlsFailed: 0, pagesIndexed: 4, startedAt: new Date(), completedAt: null, lastActivityAt: new Date() },
        createdAt: new Date(),
        updatedAt: new Date()
      });
      const jobId = result.insertedId.toString();

      const response = await request(app)
        .post(`/api/index/${jobId}/resume`);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.message, 'Job resumed');
      assert.strictEqual(response.body.jobId, jobId);
    });

    it('should return 400 for already running job', async () => {
      const result = await db.collection(COLLECTIONS.CRAWL_JOBS).insertOne({
        origin: 'https://example.com',
        maxDepth: 2,
        status: 'running',
        config: { maxQueueDepth: 1000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
        stats: { urlsQueued: 10, urlsProcessed: 5, urlsFailed: 0, pagesIndexed: 4, startedAt: new Date(), completedAt: null, lastActivityAt: new Date() },
        createdAt: new Date(),
        updatedAt: new Date()
      });
      const jobId = result.insertedId.toString();

      const response = await request(app)
        .post(`/api/index/${jobId}/resume`);

      assert.strictEqual(response.status, 400);
    });

    it('should return 404 for non-existent job', async () => {
      const fakeId = new ObjectId().toString();

      const response = await request(app)
        .post(`/api/index/${fakeId}/resume`);

      assert.strictEqual(response.status, 404);
    });
  });

  describe('DELETE /api/index/:id', () => {
    it('should cancel running job', async () => {
      const result = await db.collection(COLLECTIONS.CRAWL_JOBS).insertOne({
        origin: 'https://example.com',
        maxDepth: 2,
        status: 'running',
        config: { maxQueueDepth: 1000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
        stats: { urlsQueued: 10, urlsProcessed: 5, urlsFailed: 0, pagesIndexed: 4, startedAt: new Date(), completedAt: null, lastActivityAt: new Date() },
        createdAt: new Date(),
        updatedAt: new Date()
      });
      const jobId = result.insertedId.toString();

      const response = await request(app)
        .delete(`/api/index/${jobId}`);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.message, 'Job cancelled');
      assert.strictEqual(response.body.jobId, jobId);
    });

    it('should cancel paused job', async () => {
      const result = await db.collection(COLLECTIONS.CRAWL_JOBS).insertOne({
        origin: 'https://example.com',
        maxDepth: 2,
        status: 'paused',
        config: { maxQueueDepth: 1000, maxRequestsPerSecond: 10, maxConcurrentFetches: 5 },
        stats: { urlsQueued: 10, urlsProcessed: 5, urlsFailed: 0, pagesIndexed: 4, startedAt: new Date(), completedAt: null, lastActivityAt: new Date() },
        createdAt: new Date(),
        updatedAt: new Date()
      });
      const jobId = result.insertedId.toString();

      const response = await request(app)
        .delete(`/api/index/${jobId}`);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.message, 'Job cancelled');
      assert.strictEqual(response.body.jobId, jobId);
    });

    it('should return 404 for non-existent job', async () => {
      const fakeId = new ObjectId().toString();

      const response = await request(app)
        .delete(`/api/index/${fakeId}`);

      assert.strictEqual(response.status, 404);
    });
  });
});
