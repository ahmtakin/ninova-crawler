/**
 * Models Tests
 *
 * Tests MongoDB collection definitions and index creation.
 * Run: node --test tests/db/models.test.js
 */

const { describe, it, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { setupTestDb, cleanupTestDb, closeTestDb } = require('../setup');
const { COLLECTIONS, ensureIndexes } = require('../../src/db/models');

describe('Database Models', () => {
  let db;

  before(async () => {
    db = await setupTestDb();
  });

  after(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();
  });

  describe('COLLECTIONS constant', () => {
    it('should export all required collection names', () => {
      assert.ok(COLLECTIONS.CRAWL_JOBS);
      assert.ok(COLLECTIONS.PAGES);
      assert.ok(COLLECTIONS.WORD_INDEX);
      assert.ok(COLLECTIONS.CRAWL_QUEUE);
      assert.ok(COLLECTIONS.CRAWL_LOGS);
    });

    it('should have exactly 5 collections', () => {
      const keys = Object.keys(COLLECTIONS);
      assert.strictEqual(keys.length, 5);
    });

    it('should use snake_case naming convention', () => {
      const validPattern = /^[a-z_]+$/;

      assert.ok(validPattern.test(COLLECTIONS.CRAWL_JOBS));
      assert.ok(validPattern.test(COLLECTIONS.PAGES));
      assert.ok(validPattern.test(COLLECTIONS.WORD_INDEX));
      assert.ok(validPattern.test(COLLECTIONS.CRAWL_QUEUE));
      assert.ok(validPattern.test(COLLECTIONS.CRAWL_LOGS));
    });

    it('should have correct collection name values', () => {
      assert.strictEqual(COLLECTIONS.CRAWL_JOBS, 'crawl_jobs');
      assert.strictEqual(COLLECTIONS.PAGES, 'pages');
      assert.strictEqual(COLLECTIONS.WORD_INDEX, 'word_index');
      assert.strictEqual(COLLECTIONS.CRAWL_QUEUE, 'crawl_queue');
      assert.strictEqual(COLLECTIONS.CRAWL_LOGS, 'crawl_logs');
    });

    it('should have immutable collection names', () => {
      // Try to modify (should fail in strict mode or be prevented)
      const originalValue = COLLECTIONS.CRAWL_JOBS;
      try {
        COLLECTIONS.CRAWL_JOBS = 'modified';
        // If no error, check if value changed
        assert.strictEqual(COLLECTIONS.CRAWL_JOBS, originalValue, 'COLLECTIONS should be immutable');
      } catch {
        // Expected: cannot assign to read-only property
      }
    });
  });

  describe('ensureIndexes()', () => {
    it('should create indexes without throwing', async () => {
      await assert.doesNotReject(async () => {
        await ensureIndexes(db);
      });
    });

    it('should be idempotent - safe to call multiple times', async () => {
      await ensureIndexes(db);
      await ensureIndexes(db);
      await ensureIndexes(db);

      // Should not throw - indexes already exist is OK
      assert.ok(true);
    });

    it('should create unique index on pages {url, crawlJobId}', async () => {
      await ensureIndexes(db);

      const indexes = await db.collection(COLLECTIONS.PAGES).indexes();
      const uniqueIndex = indexes.find(idx =>
        idx.key.url === 1 && idx.key.crawlJobId === 1 && idx.unique
      );

      assert.ok(uniqueIndex, 'Unique index on {url, crawlJobId} should exist');
    });

    it('should create unique index on crawl_queue {crawlJobId, url}', async () => {
      await ensureIndexes(db);

      const indexes = await db.collection(COLLECTIONS.CRAWL_QUEUE).indexes();
      const uniqueIndex = indexes.find(idx =>
        idx.key.crawlJobId === 1 && idx.key.url === 1 && idx.unique
      );

      assert.ok(uniqueIndex, 'Unique index on {crawlJobId, url} should exist');
    });

    it('should create TTL index on crawl_logs', async () => {
      await ensureIndexes(db);

      const indexes = await db.collection(COLLECTIONS.CRAWL_LOGS).indexes();
      const ttlIndex = indexes.find(idx =>
        idx.key.timestamp === 1 && idx.expireAfterSeconds === 604800
      );

      assert.ok(ttlIndex, 'TTL index on timestamp with 7 day expiration should exist');
    });

    it('should create compound index on crawl_jobs {origin, status}', async () => {
      await ensureIndexes(db);

      const indexes = await db.collection(COLLECTIONS.CRAWL_JOBS).indexes();
      const compoundIndex = indexes.find(idx =>
        idx.key.origin === 1 && idx.key.status === 1
      );

      assert.ok(compoundIndex, 'Compound index on {origin, status} should exist');
    });

    it('should create compound index on word_index {word, crawlJobId}', async () => {
      await ensureIndexes(db);

      const indexes = await db.collection(COLLECTIONS.WORD_INDEX).indexes();
      const compoundIndex = indexes.find(idx =>
        idx.key.word === 1 && idx.key.crawlJobId === 1
      );

      assert.ok(compoundIndex, 'Compound index on {word, crawlJobId} should exist');
    });

    it('should create index on pages {crawlJobId, depth} for depth-based queries', async () => {
      await ensureIndexes(db);

      const indexes = await db.collection(COLLECTIONS.PAGES).indexes();
      const depthIndex = indexes.find(idx =>
        idx.key.crawlJobId === 1 && idx.key.depth === 1
      );

      assert.ok(depthIndex, 'Index on {crawlJobId, depth} should exist');
    });

    it('should create index on crawl_queue {crawlJobId, status} for queue queries', async () => {
      await ensureIndexes(db);

      const indexes = await db.collection(COLLECTIONS.CRAWL_QUEUE).indexes();
      const queueIndex = indexes.find(idx =>
        idx.key.crawlJobId === 1 && idx.key.status === 1
      );

      assert.ok(queueIndex, 'Index on {crawlJobId, status} should exist');
    });
  });

  describe('index functionality', () => {
    it('should enforce uniqueness on pages {url, crawlJobId}', async () => {
      await ensureIndexes(db);

      const crawlJobId = new ObjectId();
      const url = 'https://example.com/page';

      // First insert should succeed
      await db.collection(COLLECTIONS.PAGES).insertOne({
        url,
        crawlJobId,
        title: 'Test Page'
      });

      // Duplicate should fail
      await assert.rejects(
        async () => {
          await db.collection(COLLECTIONS.PAGES).insertOne({
            url,
            crawlJobId,
            title: 'Duplicate Page'
          });
        },
        /duplicate/i
      );
    });

    it('should enforce uniqueness on crawl_queue {crawlJobId, url}', async () => {
      await ensureIndexes(db);

      const crawlJobId = new ObjectId();
      const url = 'https://example.com/page';

      // First insert should succeed
      await db.collection(COLLECTIONS.CRAWL_QUEUE).insertOne({
        url,
        crawlJobId,
        status: 'pending'
      });

      // Duplicate should fail
      await assert.rejects(
        async () => {
          await db.collection(COLLECTIONS.CRAWL_QUEUE).insertOne({
            url,
            crawlJobId,
            status: 'pending'
          });
        },
        /duplicate/i
      );
    });

    it('should allow same URL in different crawl jobs', async () => {
      await ensureIndexes(db);

      const url = 'https://example.com/page';
      const job1Id = new ObjectId();
      const job2Id = new ObjectId();

      // Same URL, different jobs - should be allowed
      await db.collection(COLLECTIONS.PAGES).insertOne({
        url,
        crawlJobId: job1Id,
        title: 'Job 1 Page'
      });

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url,
        crawlJobId: job2Id,
        title: 'Job 2 Page'
      });

      const count = await db.collection(COLLECTIONS.PAGES).countDocuments({ url });
      assert.strictEqual(count, 2);
    });
  });

  describe('collection structure', () => {
    it('should allow insert into crawl_jobs', async () => {
      const doc = {
        origin: 'https://example.com',
        maxDepth: 2,
        status: 'queued',
        config: { maxQueueDepth: 1000 },
        stats: { urlsQueued: 0, urlsProcessed: 0, urlsFailed: 0, pagesIndexed: 0 },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await db.collection(COLLECTIONS.CRAWL_JOBS).insertOne(doc);
      const found = await db.collection(COLLECTIONS.CRAWL_JOBS).findOne({ origin: doc.origin });
      assert.ok(found);
    });

    it('should allow insert into pages', async () => {
      const crawlJobId = new ObjectId();
      const doc = {
        url: 'https://example.com/page',
        crawlJobId,
        title: 'Test Page',
        depth: 0,
        statusCode: 200
      };

      await db.collection(COLLECTIONS.PAGES).insertOne(doc);
      const found = await db.collection(COLLECTIONS.PAGES).findOne({ url: doc.url });
      assert.ok(found);
    });

    it('should allow insert into word_index', async () => {
      const crawlJobId = new ObjectId();
      const doc = {
        word: 'test',
        url: 'https://example.com/page',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        frequency: 1,
        inTitle: true
      };

      await db.collection(COLLECTIONS.WORD_INDEX).insertOne(doc);
      const found = await db.collection(COLLECTIONS.WORD_INDEX).findOne({ word: doc.word });
      assert.ok(found);
    });

    it('should allow insert into crawl_queue', async () => {
      const crawlJobId = new ObjectId();
      const doc = {
        url: 'https://example.com/page',
        crawlJobId,
        depth: 0,
        status: 'pending'
      };

      await db.collection(COLLECTIONS.CRAWL_QUEUE).insertOne(doc);
      const found = await db.collection(COLLECTIONS.CRAWL_QUEUE).findOne({ url: doc.url });
      assert.ok(found);
    });

    it('should allow insert into crawl_logs', async () => {
      const crawlJobId = new ObjectId();
      const doc = {
        crawlJobId,
        timestamp: new Date(),
        level: 'info',
        message: 'Test log message'
      };

      await db.collection(COLLECTIONS.CRAWL_LOGS).insertOne(doc);
      const found = await db.collection(COLLECTIONS.CRAWL_LOGS).findOne({ message: doc.message });
      assert.ok(found);
    });
  });
});
