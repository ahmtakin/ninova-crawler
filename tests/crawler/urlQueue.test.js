/**
 * URL Queue Tests
 *
 * Tests the UrlQueue class that manages crawl queue state.
 * Run: node --test tests/crawler/urlQueue.test.js
 */

const { describe, it, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { setupTestDb, getTestDb, cleanupTestDb, closeTestDb } = require('../setup');
const { COLLECTIONS } = require('../../src/db/models');

// UrlQueue will be loaded after mocks are set up
let UrlQueue;

describe('UrlQueue', () => {
  let db;
  let queueRedis;
  let crawlJobId;
  let urlQueue;

  before(async () => {
    db = await setupTestDb();
    crawlJobId = new ObjectId();

    // Load UrlQueue module (will be mocked in beforeEach)
    UrlQueue = require('../../src/crawler/urlQueue');
  });

  after(async () => {
    // Restore mocks to prevent leakage to other test suites
    const mongoModule = require('../../src/db/mongo');
    const redisModule = require('../../src/db/redis');

    if (mongoModule.getDb && mongoModule.getDb.mock) {
      mongoModule.getDb.mock.restore();
    }
    if (redisModule.getCacheRedis && redisModule.getCacheRedis.mock) {
      redisModule.getCacheRedis.mock.restore();
    }

    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();

    // Create fresh crawlJobId and UrlQueue instance for each test
    crawlJobId = new ObjectId();

    // Clear require cache for urlQueue to prevent module caching issues
    delete require.cache[require.resolve('../../src/crawler/urlQueue')];

    // Set up fresh mocks for each test to ensure isolation
    const mongoModule = require('../../src/db/mongo');
    const redisModule = require('../../src/db/redis');

    // Restore any existing mocks first
    if (mongoModule.getDb && mongoModule.getDb.mock) {
      mongoModule.getDb.mock.restore();
    }
    if (redisModule.getCacheRedis && redisModule.getCacheRedis.mock) {
      redisModule.getCacheRedis.mock.restore();
    }

    // Create fresh mocks
    mock.method(mongoModule, 'getDb', () => db);

    // Reload UrlQueue module with fresh mocks
    UrlQueue = require('../../src/crawler/urlQueue');

    // Create fresh Redis mock for each test to avoid state pollution
    const freshQueueRedis = {
      sadd: async () => 1, // Simulate new URL
      del: async () => Promise.resolve(1),
    };
    urlQueue = new UrlQueue(db, freshQueueRedis, crawlJobId);
  });

  afterEach(() => {
    // Restore mocks to prevent leakage to other test suites
    const mongoModule = require('../../src/db/mongo');
    if (mongoModule.getDb && mongoModule.getDb.mock) {
      mongoModule.getDb.mock.restore();
    }

    const redisModule = require('../../src/db/redis');
    if (redisModule.getCacheRedis && redisModule.getCacheRedis.mock) {
      redisModule.getCacheRedis.mock.restore();
    }
  });

  describe('enqueue()', () => {
    it('should add URL to queue', async () => {
      const added = await urlQueue.enqueue('https://example.com/page1', 0);

      assert.strictEqual(added, true);

      const count = await db.collection(COLLECTIONS.CRAWL_QUEUE).countDocuments({
        crawlJobId,
        url: 'https://example.com/page1'
      });
      assert.strictEqual(count, 1);
    });

    it('should store URL with correct status', async () => {
      await urlQueue.enqueue('https://example.com/page1', 1);

      const item = await db.collection(COLLECTIONS.CRAWL_QUEUE).findOne({
        crawlJobId,
        url: 'https://example.com/page1'
      });

      assert.strictEqual(item.status, 'pending');
      assert.strictEqual(item.depth, 1);
    });

    it('should handle multiple URLs', async () => {
      await urlQueue.enqueue('https://example.com/page1', 0);
      await urlQueue.enqueue('https://example.com/page2', 0);
      await urlQueue.enqueue('https://example.com/page3', 1);

      const count = await db.collection(COLLECTIONS.CRAWL_QUEUE).countDocuments({
        crawlJobId
      });

      assert.strictEqual(count, 3);
    });
  });

  describe('dequeueBatch()', () => {
    it('should get next batch of pending URLs', async () => {
      await urlQueue.enqueue('https://example.com/page1', 0);
      await urlQueue.enqueue('https://example.com/page2', 0);
      await urlQueue.enqueue('https://example.com/page3', 1);

      const batch = await urlQueue.dequeueBatch(2);

      assert.strictEqual(batch.length, 2);
      assert.ok(batch[0].url);
      assert.ok(batch[0]._id);
    });

    it('should mark URLs as processing when dequeued', async () => {
      await urlQueue.enqueue('https://example.com/page1', 0);

      const batch = await urlQueue.dequeueBatch(1);

      assert.strictEqual(batch.length, 1);

      const item = await db.collection(COLLECTIONS.CRAWL_QUEUE).findOne({
        crawlJobId,
        url: 'https://example.com/page1'
      });

      assert.strictEqual(item.status, 'processing');
    });

    it('should return empty array when no pending URLs', async () => {
      const batch = await urlQueue.dequeueBatch(10);

      assert.deepStrictEqual(batch, []);
    });

    it('should respect batch size limit', async () => {
      await urlQueue.enqueue('https://example.com/page1', 0);
      await urlQueue.enqueue('https://example.com/page2', 0);
      await urlQueue.enqueue('https://example.com/page3', 0);

      const batch = await urlQueue.dequeueBatch(2);

      assert.strictEqual(batch.length, 2);
    });

    it('should sort by depth then creation time (BFS order)', async () => {
      await urlQueue.enqueue('https://example.com/page1', 0);
      await urlQueue.enqueue('https://example.com/page2', 1);
      await urlQueue.enqueue('https://example.com/page3', 0);

      const batch = await urlQueue.dequeueBatch(3);

      assert.strictEqual(batch.length, 3);
      // Depth 0 items should come first
      assert.strictEqual(batch[0].depth, 0);
      assert.strictEqual(batch[1].depth, 0);
      assert.strictEqual(batch[2].depth, 1);
    });
  });

  describe('markDone()', () => {
    it('should mark URL as done', async () => {
      await urlQueue.enqueue('https://example.com/page1', 0);
      const batch = await urlQueue.dequeueBatch(1);
      const queueItemId = batch[0]._id;

      await urlQueue.markDone(queueItemId);

      const item = await db.collection(COLLECTIONS.CRAWL_QUEUE).findOne({
        crawlJobId,
        url: 'https://example.com/page1'
      });

      assert.strictEqual(item.status, 'done');
      assert.ok(item.processedAt);
    });
  });

  describe('markFailed()', () => {
    it('should mark URL as failed', async () => {
      await urlQueue.enqueue('https://example.com/page1', 0);
      const batch = await urlQueue.dequeueBatch(1);
      const queueItemId = batch[0]._id;

      await urlQueue.markFailed(queueItemId, 'Connection timeout');

      const item = await db.collection(COLLECTIONS.CRAWL_QUEUE).findOne({
        crawlJobId,
        url: 'https://example.com/page1'
      });

      assert.strictEqual(item.status, 'failed');
      assert.strictEqual(item.error, 'Connection timeout');
      assert.ok(item.processedAt);
    });

    it('should truncate error message to 500 chars', async () => {
      await urlQueue.enqueue('https://example.com/page1', 0);
      const batch = await urlQueue.dequeueBatch(1);
      const queueItemId = batch[0]._id;

      const longError = 'x'.repeat(600);
      await urlQueue.markFailed(queueItemId, longError);

      const item = await db.collection(COLLECTIONS.CRAWL_QUEUE).findOne({
        crawlJobId,
        url: 'https://example.com/page1'
      });

      assert.ok(item.error.length <= 500);
    });
  });

  describe('getPendingCount()', () => {
    it('should return count of pending URLs', async () => {
      await urlQueue.enqueue('https://example.com/page1', 0);
      await urlQueue.enqueue('https://example.com/page2', 0);
      await urlQueue.enqueue('https://example.com/page3', 0);

      const count = await urlQueue.getPendingCount();

      assert.strictEqual(count, 3);
    });

    it('should return 0 when no pending URLs', async () => {
      const count = await urlQueue.getPendingCount();

      assert.strictEqual(count, 0);
    });

    it('should not count processing URLs', async () => {
      await urlQueue.enqueue('https://example.com/page1', 0);
      await urlQueue.enqueue('https://example.com/page2', 0);

      await urlQueue.dequeueBatch(1); // Marks first as processing

      const count = await urlQueue.getPendingCount();

      assert.strictEqual(count, 1); // Only second URL is still pending
    });
  });

  describe('getStats()', () => {
    it('should return queue statistics', async () => {
      // Add URLs with different statuses
      await urlQueue.enqueue('https://example.com/pending', 0);
      await urlQueue.enqueue('https://example.com/processing', 0);
      await urlQueue.enqueue('https://example.com/done', 0);

      // Mark one as processing, one as done
      const batch = await urlQueue.dequeueBatch(1);
      await urlQueue.markDone(batch[0]._id);

      const stats = await urlQueue.getStats();

      assert.strictEqual(typeof stats.pending, 'number');
      assert.strictEqual(typeof stats.processing, 'number');
      assert.strictEqual(typeof stats.done, 'number');
      assert.strictEqual(typeof stats.failed, 'number');
      assert.ok(stats.pending >= 0);
    });

    it('should return zero stats for empty queue', async () => {
      const stats = await urlQueue.getStats();

      assert.deepStrictEqual(stats, { pending: 0, processing: 0, done: 0, failed: 0 });
    });

    it('should count each status correctly', async () => {
      await urlQueue.enqueue('https://example.com/page1', 0);
      await urlQueue.enqueue('https://example.com/page2', 0);
      await urlQueue.enqueue('https://example.com/page3', 0);

      // Mark one as done
      const batch = await urlQueue.dequeueBatch(1);
      await urlQueue.markDone(batch[0]._id);

      const stats = await urlQueue.getStats();

      assert.strictEqual(stats.pending, 2);
      assert.strictEqual(stats.processing, 0);
      assert.strictEqual(stats.done, 1);
    });
  });

  describe('rebuildVisitedSet()', () => {
    it('should rebuild visited set from database', async () => {
      await urlQueue.enqueue('https://example.com/page1', 0);
      await urlQueue.enqueue('https://example.com/page2', 1);
      await urlQueue.enqueue('https://example.com/page3', 2);

      // Create a tracking Redis mock
      let saddUrls = [];
      const trackingRedis = {
        sadd: async (key, ...urls) => {
          saddUrls.push(...urls);
          return urls.length;
        },
        del: async () => Promise.resolve(1),
      };

      // Create new UrlQueue with tracking mock
      const trackingQueue = new UrlQueue(db, trackingRedis, crawlJobId);
      await trackingQueue.rebuildVisitedSet();

      assert.ok(saddUrls.length >= 3);
      assert.ok(saddUrls.includes('https://example.com/page1'));
      assert.ok(saddUrls.includes('https://example.com/page2'));
      assert.ok(saddUrls.includes('https://example.com/page3'));
    });

    it('should handle empty queue', async () => {
      let saddCalled = false;
      const trackingRedis = {
        sadd: async () => {
          saddCalled = true;
          return 0;
        },
        del: async () => Promise.resolve(1),
      };

      const trackingQueue = new UrlQueue(db, trackingRedis, crawlJobId);
      await trackingQueue.rebuildVisitedSet();

      // Should not call sadd if no URLs
      assert.strictEqual(saddCalled, false);
    });
  });

  describe('resetProcessingItems()', () => {
    it('should reset processing URLs back to pending', async () => {
      await urlQueue.enqueue('https://example.com/page1', 0);
      await urlQueue.enqueue('https://example.com/page2', 0);

      // Mark both as processing
      await urlQueue.dequeueBatch(2);

      // Reset
      await urlQueue.resetProcessingItems();

      const count = await urlQueue.getPendingCount();

      assert.strictEqual(count, 2);
    });

    it('should handle no processing items', async () => {
      await urlQueue.enqueue('https://example.com/page1', 0);

      await urlQueue.resetProcessingItems();

      const count = await urlQueue.getPendingCount();

      assert.strictEqual(count, 1);
    });
  });

  describe('cleanup()', () => {
    it('should delete visited set from Redis', async () => {
      let deletedKey = null;
      const trackingRedis = {
        sadd: async () => 1,
        del: async (key) => {
          deletedKey = key;
          return 1;
        },
      };

      const trackingQueue = new UrlQueue(db, trackingRedis, crawlJobId);
      await trackingQueue.cleanup();

      assert.strictEqual(deletedKey, `visited:${crawlJobId.toString()}`);
    });
  });

  describe('duplicate handling with Redis', () => {
    it('should not add duplicate URLs via Redis', async () => {
      // Create a Redis mock that returns 1 on first call, 0 on subsequent
      let saddCallCount = 0;
      const duplicateDetectingRedis = {
        sadd: async (key, url) => {
          saddCallCount++;
          // Return 1 (new) for first call, 0 (duplicate) for subsequent calls
          return saddCallCount === 1 ? 1 : 0;
        },
        del: async () => Promise.resolve(1),
      };

      const queueWithDuplicateCheck = new UrlQueue(db, duplicateDetectingRedis, crawlJobId);

      // First add should succeed (Redis returns 1)
      const added1 = await queueWithDuplicateCheck.enqueue('https://example.com/page1', 0);
      assert.strictEqual(added1, true);

      // Second add should fail (Redis returns 0 - duplicate)
      const added2 = await queueWithDuplicateCheck.enqueue('https://example.com/page1', 0);
      assert.strictEqual(added2, false);

      // Should still only have one entry in MongoDB
      const count = await db.collection(COLLECTIONS.CRAWL_QUEUE).countDocuments({
        crawlJobId,
        url: 'https://example.com/page1'
      });
      assert.strictEqual(count, 1);
    });
  });
});
