/**
 * Tests for GET /api/logs/:jobId endpoint
 *
 * Tests the logs API that returns paginated crawl job logs
 * with filtering by log level.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const express = require('express');
const { ObjectId } = require('mongodb');
const { connect, close, getDb } = require('../../src/db/mongo');
const { COLLECTIONS } = require('../../src/db/models');
const { createJobLogger } = require('../../src/crawler/jobLogger');

// Import the actual controller
const logsRouter = require('../../src/api/logsController');

describe('GET /api/logs/:jobId', () => {
  let app;
  let db;

  before(async () => {
    db = await connect();

    // Set up test app with the actual logs router
    app = express();
    app.use(express.json());
    app.use('/api/logs', logsRouter);
  });

  after(async () => {
    await close();
  });

  it('should return 400 for invalid ObjectId', async () => {
    const response = await request(app)
      .get('/api/logs/invalid-id')
      .expect(400);

    assert.ok(response.body.error);
  });

  it('should return logs array for valid job', async () => {
    const jobId = new ObjectId();
    const logger = createJobLogger(jobId);

    // Create some test logs
    await logger.info('Test info message', { url: 'http://example.com' });
    await logger.warn('Test warning message', { code: 404 });
    await logger.error('Test error message', { error: 'Not found' });

    const response = await request(app)
      .get(`/api/logs/${jobId.toString()}`)
      .expect(200);

    assert.ok(Array.isArray(response.body.logs));
    assert.strictEqual(typeof response.body.total, 'number');
    assert.strictEqual(response.body.total, 3);
    assert.strictEqual(typeof response.body.limit, 'number');
    assert.strictEqual(typeof response.body.offset, 'number');
  });

  it('should respect limit parameter with max of 500', async () => {
    const jobId = new ObjectId();
    const logger = createJobLogger(jobId);

    // Create some test logs
    for (let i = 0; i < 10; i++) {
      await logger.info(`Test message ${i}`);
    }

    const response = await request(app)
      .get(`/api/logs/${jobId.toString()}?limit=1000`)
      .expect(200);

    assert.ok(response.body.limit <= 500);
    assert.strictEqual(response.body.logs.length, 10);
  });

  it('should filter by log level when provided', async () => {
    const jobId = new ObjectId();
    const logger = createJobLogger(jobId);

    await logger.info('Info message');
    await logger.warn('Warning message');
    await logger.error('Error message');

    const response = await request(app)
      .get(`/api/logs/${jobId.toString()}?level=error`)
      .expect(200);

    assert.ok(Array.isArray(response.body.logs));
    assert.strictEqual(response.body.total, 1);
    assert.strictEqual(response.body.logs[0].level, 'error');
  });

  it('should support pagination with offset', async () => {
    const jobId = new ObjectId();
    const logger = createJobLogger(jobId);

    // Create test logs with predictable order
    for (let i = 0; i < 10; i++) {
      await logger.info(`Message ${i}`);
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const response = await request(app)
      .get(`/api/logs/${jobId.toString()}?offset=5&limit=3`)
      .expect(200);

    assert.strictEqual(response.body.offset, 5);
    assert.strictEqual(response.body.limit, 3);
    assert.strictEqual(response.body.logs.length, 3);
    assert.strictEqual(response.body.total, 10);
  });

  it('should return empty array for job with no logs', async () => {
    const jobId = new ObjectId();

    const response = await request(app)
      .get(`/api/logs/${jobId.toString()}`)
      .expect(200);

    assert.strictEqual(response.body.logs.length, 0);
    assert.strictEqual(response.body.total, 0);
  });

  it('should return logs sorted by timestamp descending', async () => {
    const jobId = new ObjectId();
    const logger = createJobLogger(jobId);

    await logger.info('First message');
    await new Promise(resolve => setTimeout(resolve, 10));
    await logger.info('Second message');
    await new Promise(resolve => setTimeout(resolve, 10));
    await logger.info('Third message');

    const response = await request(app)
      .get(`/api/logs/${jobId.toString()}`)
      .expect(200);

    assert.strictEqual(response.body.logs.length, 3);
    // Most recent should be first
    assert.ok(response.body.logs[0].timestamp >= response.body.logs[1].timestamp);
    assert.ok(response.body.logs[1].timestamp >= response.body.logs[2].timestamp);
  });

  it('should ignore invalid log level filter', async () => {
    const jobId = new ObjectId();
    const logger = createJobLogger(jobId);

    await logger.info('Info message');
    await logger.error('Error message');

    const response = await request(app)
      .get(`/api/logs/${jobId.toString()}?level=invalid`)
      .expect(200);

    // Should return all logs when filter is invalid
    assert.strictEqual(response.body.total, 2);
  });
});
