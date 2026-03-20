/**
 * Tests for the job logger utility.
 * Run: node --test tests/crawler/jobLogger.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { createJobLogger } = require('../../src/crawler/jobLogger');
const { connect, close, getDb } = require('../../src/db/mongo');
const { COLLECTIONS } = require('../../src/db/models');

describe('createJobLogger', () => {
  let db;

  before(async () => {
    db = await connect();
  });

  after(async () => {
    await close();
  });

  it('should return a logger with info, warn, error methods', () => {
    const jobId = new ObjectId();
    const logger = createJobLogger(jobId);
    assert.strictEqual(typeof logger.info, 'function');
    assert.strictEqual(typeof logger.warn, 'function');
    assert.strictEqual(typeof logger.error, 'function');
  });

  it('should write log entry to database', async () => {
    const jobId = new ObjectId();
    const logger = createJobLogger(jobId);
    await logger.info('Test message', { url: 'http://test.com' });

    const logs = await db.collection(COLLECTIONS.CRAWL_LOGS)
      .find({ crawlJobId: jobId })
      .toArray();
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].message, 'Test message');
    assert.strictEqual(logs[0].level, 'info');
    assert.deepStrictEqual(logs[0].meta, { url: 'http://test.com' });
  });

  it('should write logs with different levels', async () => {
    const jobId = new ObjectId();
    const logger = createJobLogger(jobId);

    await logger.warn('Warning message', { code: 123 });
    await logger.error('Error message', { error: 'Something went wrong' });

    const logs = await db.collection(COLLECTIONS.CRAWL_LOGS)
      .find({ crawlJobId: jobId })
      .toArray();

    assert.strictEqual(logs.length, 2);

    const warnLog = logs.find(log => log.level === 'warn');
    const errorLog = logs.find(log => log.level === 'error');

    assert.ok(warnLog, 'Should have a warn log');
    assert.ok(errorLog, 'Should have an error log');
    assert.strictEqual(warnLog.message, 'Warning message');
    assert.strictEqual(errorLog.message, 'Error message');
    assert.deepStrictEqual(warnLog.meta, { code: 123 });
    assert.deepStrictEqual(errorLog.meta, { error: 'Something went wrong' });
  });

  it('should handle logging without metadata', async () => {
    const jobId = new ObjectId();
    const logger = createJobLogger(jobId);
    await logger.info('Message without metadata');

    const logs = await db.collection(COLLECTIONS.CRAWL_LOGS)
      .find({ crawlJobId: jobId })
      .toArray();
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].message, 'Message without metadata');
    assert.deepStrictEqual(logs[0].meta, {});
  });
});
