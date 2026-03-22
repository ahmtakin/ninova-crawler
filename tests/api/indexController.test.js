/**
 * Index Controller Tests
 *
 * Tests the crawl job management API endpoints.
 * Run: node --test tests/api/indexController.test.js
 */

const { describe, it, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const request = require('supertest');

const { setupTestDb, getTestDb, cleanupTestDb, closeTestDb } = require('../setup');
const { COLLECTIONS } = require('../../src/db/models');

describe('Index Controller API', () => {
  let db;
  let app;
  let getDbMock;

  before(async () => {
    db = await setupTestDb();

    // Mock getDb
    const mongoModule = require('../../src/db/mongo');
    getDbMock = mock.method(mongoModule, 'getDb', () => db);

    // Mock the crawlManager to avoid Redis dependency
    const crawlManagerModule = require('../../src/crawler/crawlManager');
    mock.method(crawlManagerModule, 'startCrawl', async (origin, depth, config) => {
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

    mock.method(crawlManagerModule, 'getAllJobs', async () => {
      return await db.collection(COLLECTIONS.CRAWL_JOBS).find().toArray();
    });

    mock.method(crawlManagerModule, 'getJobStatus', async (jobId) => {
      return await db.collection(COLLECTIONS.CRAWL_JOBS).findOne({ _id: new ObjectId(jobId) });
    });

    // Mock pauseJob, resumeJob, cancelJob
    mock.method(crawlManagerModule, 'pauseJob', async (jobId) => {
      const result = await db.collection(COLLECTIONS.CRAWL_JOBS).updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { status: 'paused', updatedAt: new Date() } }
      );
      return result.modifiedCount > 0;
    });

    mock.method(crawlManagerModule, 'resumeJob', async (jobId) => {
      const result = await db.collection(COLLECTIONS.CRAWL_JOBS).updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { status: 'running', updatedAt: new Date() } }
      );
      return result.modifiedCount > 0;
    });

    mock.method(crawlManagerModule, 'cancelJob', async (jobId) => {
      const result = await db.collection(COLLECTIONS.CRAWL_JOBS).updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { status: 'cancelled', updatedAt: new Date() } }
      );
      return result.modifiedCount > 0;
    });

    // Load Express app with routes
    const express = require('express');
    app = express();
    app.use(express.json());

    // Load routes after mocking
    const apiRoutes = require('../../src/api/routes');
    app.use('/api', apiRoutes);
  });

  after(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();
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
