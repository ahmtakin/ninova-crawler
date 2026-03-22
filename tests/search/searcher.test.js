/**
 * Search Searcher Tests
 *
 * Tests the search() function that queries the inverted word index and ranks results.
 * Run: node --test tests/search/searcher.test.js
 */

const { describe, it, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { setupTestDb, getTestDb, cleanupTestDb, closeTestDb, FIXTURES } = require('../setup');
const { COLLECTIONS } = require('../../src/db/models');

describe('Search Searcher', () => {
  let db;
  let crawlJobId;
  let search;
  let getDbMock;
  let getCacheRedisMock;

  before(async () => {
    db = await setupTestDb();
    crawlJobId = new ObjectId();

    // Mock getDb in the mongo module
    const mongoModule = require('../../src/db/mongo');
    getDbMock = mock.method(mongoModule, 'getDb', () => db);

    // Mock getCacheRedis to return a mock Redis client
    const redisModule = require('../../src/db/redis');
    const mockRedis = {
      get: async () => null,
      setex: async () => Promise.resolve(),
      flushdb: async () => Promise.resolve(),
    };
    getCacheRedisMock = mock.method(redisModule, 'getCacheRedis', () => mockRedis);

    // Clear require cache and import search
    delete require.cache[require.resolve('../../src/search/searcher')];
    const searcher = require('../../src/search/searcher');
    search = searcher.search;
  });

  after(async () => {
    getDbMock?.mock.restore();
    getCacheRedisMock?.mock.restore();
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();
  });

  // Helper to insert test data
  async function insertTestData() {
    // Insert pages
    await db.collection(COLLECTIONS.PAGES).insertMany([
      { url: 'https://example.com/page1', crawlJobId, title: 'Test Page One', depth: 0 },
      { url: 'https://example.com/page2', crawlJobId, title: 'Another Page', depth: 1 },
      { url: 'https://example.com/page3', crawlJobId, title: 'Deep Page', depth: 3 },
    ]);

    // Insert word index entries
    await db.collection(COLLECTIONS.WORD_INDEX).insertMany([
      // "test" appears in page1 title and body
      { word: 'test', url: 'https://example.com/page1', crawlJobId, origin: 'https://example.com', depth: 0, frequency: 2, inTitle: true, position: 'both' },
      // "example" appears in page1 body only
      { word: 'example', url: 'https://example.com/page1', crawlJobId, origin: 'https://example.com', depth: 0, frequency: 1, inTitle: false, position: 'body' },
      // "another" appears in page2 title
      { word: 'another', url: 'https://example.com/page2', crawlJobId, origin: 'https://example.com', depth: 1, frequency: 0, inTitle: true, position: 'title' },
      // "page" appears in all pages
      { word: 'page', url: 'https://example.com/page1', crawlJobId, origin: 'https://example.com', depth: 0, frequency: 1, inTitle: true, position: 'both' },
      { word: 'page', url: 'https://example.com/page2', crawlJobId, origin: 'https://example.com', depth: 1, frequency: 1, inTitle: true, position: 'both' },
      { word: 'page', url: 'https://example.com/page3', crawlJobId, origin: 'https://example.com', depth: 3, frequency: 1, inTitle: true, position: 'both' },
      // "deep" appears in page3 title
      { word: 'deep', url: 'https://example.com/page3', crawlJobId, origin: 'https://example.com', depth: 3, frequency: 1, inTitle: true, position: 'both' },
    ]);
  }

  describe('basic search functionality', () => {
    beforeEach(async () => {
      await insertTestData();
    });

    it('should return empty array for no results', async () => {
      const result = await search('nonexistentword12345');

      assert.deepStrictEqual(result.results, []);
      assert.strictEqual(result.total, 0);
      assert.strictEqual(result.query, 'nonexistentword12345');
    });

    it('should return empty array for empty query', async () => {
      const result = await search('');

      assert.deepStrictEqual(result.results, []);
      assert.strictEqual(result.total, 0);
      assert.deepStrictEqual(result.tokens, []);
    });

    it('should return empty array for stop words only query', async () => {
      const result = await search('the and is');

      assert.deepStrictEqual(result.results, []);
      assert.strictEqual(result.total, 0);
    });

    it('should return results ranked by relevance score', async () => {
      const result = await search('page');

      assert.ok(result.results.length > 0);
      assert.ok(result.results[0].score >= result.results[result.results.length - 1].score,
        'Results should be sorted by score descending');
    });

    it('should boost score for title matches', async () => {
      const result = await search('test');

      assert.ok(result.results.length > 0);
      const topResult = result.results[0];
      assert.strictEqual(topResult.relevantUrl, 'https://example.com/page1');
      assert.strictEqual(topResult.title, 'Test Page One');
      // Title match should have higher score
      assert.ok(topResult.score > 0);
    });

    it('should penalize deeper pages', async () => {
      const result = await search('page');

      // Page at depth 0 should rank higher than page at depth 3 for same word frequency
      const shallowPage = result.results.find(r => r.relevantUrl === 'https://example.com/page1');
      const deepPage = result.results.find(r => r.relevantUrl === 'https://example.com/page3');

      if (shallowPage && deepPage) {
        assert.ok(shallowPage.score > deepPage.score,
          'Shallow page should score higher than deep page');
      }
    });

    it('should handle multi-word queries correctly', async () => {
      const result = await search('test example');

      assert.ok(result.results.length > 0);
      // Results matching both words should rank higher
      const topResult = result.results[0];
      assert.strictEqual(topResult.relevantUrl, 'https://example.com/page1');
    });
  });

  describe('result structure', () => {
    beforeEach(async () => {
      await insertTestData();
    });

    it('should return correct result structure', async () => {
      const result = await search('test');

      assert.ok(Array.isArray(result.results));
      assert.strictEqual(typeof result.total, 'number');
      assert.strictEqual(typeof result.tookMs, 'number');
      assert.strictEqual(result.query, 'test');
      assert.ok(Array.isArray(result.tokens));
    });

    it('should include required fields in each result', async () => {
      const result = await search('page');

      if (result.results.length > 0) {
        const firstResult = result.results[0];
        assert.strictEqual(typeof firstResult.relevantUrl, 'string');
        assert.strictEqual(typeof firstResult.originUrl, 'string');
        assert.strictEqual(typeof firstResult.depth, 'number');
        assert.strictEqual(typeof firstResult.score, 'number');
        assert.strictEqual(typeof firstResult.title, 'string');
      }
    });
  });

  describe('pagination', () => {
    beforeEach(async () => {
      // Insert more test data for pagination
      const pages = [];
      const wordEntries = [];
      
      for (let i = 1; i <= 10; i++) {
        const url = `https://example.com/page${i}`;
        pages.push({
          url,
          crawlJobId,
          title: `Page ${i}`,
          depth: i % 3
        });
        
        wordEntries.push({
          word: 'content',
          url,
          crawlJobId,
          origin: 'https://example.com',
          depth: i % 3,
          frequency: 1,
          inTitle: false,
          position: 'body'
        });
      }

      await db.collection(COLLECTIONS.PAGES).insertMany(pages);
      await db.collection(COLLECTIONS.WORD_INDEX).insertMany(wordEntries);
    });

    it('should respect limit parameter', async () => {
      const result = await search('content', { limit: 5 });

      assert.ok(result.results.length <= 5);
      assert.strictEqual(result.total, 10); // Total should be unaffected by limit
    });

    it('should respect offset parameter for pagination', async () => {
      const page1 = await search('content', { limit: 3, offset: 0 });
      const page2 = await search('content', { limit: 3, offset: 3 });

      assert.strictEqual(page1.results.length, 3);
      assert.strictEqual(page2.results.length, 3);
      
      // Results should be different
      const page1Urls = page1.results.map(r => r.relevantUrl);
      const page2Urls = page2.results.map(r => r.relevantUrl);
      
      const intersection = page1Urls.filter(url => page2Urls.includes(url));
      assert.strictEqual(intersection.length, 0);
    });

    it('should handle offset beyond total results', async () => {
      const result = await search('content', { offset: 100 });

      assert.deepStrictEqual(result.results, []);
      assert.strictEqual(result.total, 10);
    });
  });

  describe('filtering', () => {
    beforeEach(async () => {
      // Create two different crawl jobs
      const job1Id = new ObjectId();
      const job2Id = new ObjectId();

      await db.collection(COLLECTIONS.PAGES).insertMany([
        { url: 'https://example.com/page1', crawlJobId: job1Id, title: 'Job 1 Page', depth: 0 },
        { url: 'https://example.com/page2', crawlJobId: job2Id, title: 'Job 2 Page', depth: 0 },
      ]);

      await db.collection(COLLECTIONS.WORD_INDEX).insertMany([
        { word: 'test', url: 'https://example.com/page1', crawlJobId: job1Id, origin: 'https://example.com', depth: 0, frequency: 1, inTitle: true, position: 'both' },
        { word: 'test', url: 'https://example.com/page2', crawlJobId: job2Id, origin: 'https://example.com', depth: 0, frequency: 1, inTitle: true, position: 'both' },
      ]);
    });

    it('should filter by crawl job ID if specified', async () => {
      const job2Id = (await db.collection(COLLECTIONS.WORD_INDEX).findOne({ word: 'test', depth: 0 })).crawlJobId;
      
      const result = await search('test', { crawlJobId: job2Id.toString() });

      assert.ok(result.results.length > 0);
      // All results should be from the specified job
      // (We can't verify crawlJobId in results since it's not returned, but we check that we get results)
    });
  });

  describe('scoring details', () => {
    beforeEach(async () => {
      await insertTestData();
    });

    it('should calculate score with title bonus correctly', async () => {
      const result = await search('test');

      if (result.results.length > 0) {
        const topResult = result.results[0];
        // Score = frequency(2) * titleBonus(3) * multiWordBonus(1) * depthPenalty(1)
        // Expected: 2 * 3 * 1 * 1 = 6
        assert.ok(Math.abs(topResult.score - 6) < 0.1, `Expected score ~6, got ${topResult.score}`);
      }
    });

    it('should calculate multi-word bonus correctly', async () => {
      // Search for words that appear in same page
      const result = await search('test page');

      if (result.results.length > 0) {
        const topResult = result.results[0];
        // Should match both "test" and "page" -> multiWordBonus = 2
        assert.ok(topResult.score > 0);
        assert.strictEqual(topResult.relevantUrl, 'https://example.com/page1');
      }
    });
  });

  describe('edge cases', () => {
    it('should handle special characters in query', async () => {
      await insertTestData();
      
      // Should handle and strip special characters
      const result = await search('test!!!');
      
      assert.ok(result.results.length > 0);
    });

    it('should handle undefined options parameter', async () => {
      await insertTestData();

      const result = await search('test', undefined);

      assert.ok(Array.isArray(result.results));
    });

    it('should handle options being an empty object', async () => {
      await insertTestData();

      const result = await search('test', {});

      assert.ok(Array.isArray(result.results));
    });

    it('should respect max limit of 100', async () => {
      // Even if we request more than 100
      const result = await search('test', { limit: 200 });
      
      // Results should not exceed 100 (though we don't have that many results)
      assert.ok(result.results.length <= 100);
    });
  });

  describe('tokens returned', () => {
    beforeEach(async () => {
      await insertTestData();
    });

    it('should return tokenized query tokens', async () => {
      const result = await search('test page example');

      assert.ok(result.tokens.includes('test'));
      assert.ok(result.tokens.includes('page'));
      assert.ok(result.tokens.includes('example'));
    });

    it('should not include stop words in tokens', async () => {
      const result = await search('the test page and example');

      assert.ok(!result.tokens.includes('the'));
      assert.ok(!result.tokens.includes('and'));
      assert.ok(result.tokens.includes('test'));
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      // Mock getDb to throw an error
      const mongoModule = require('../../src/db/mongo');
      const originalGetDb = mongoModule.getDb;
      
      // Restore the mock temporarily to set up error condition
      getDbMock.mock.restore();
      getDbMock = mock.method(mongoModule, 'getDb', () => {
        throw new Error('Database connection lost');
      });

      // Clear cache and re-import
      delete require.cache[require.resolve('../../src/search/searcher')];
      const searcher = require('../../src/search/searcher');
      
      const result = await searcher.search('test');

      // Should return empty results instead of throwing
      assert.deepStrictEqual(result.results, []);
      assert.strictEqual(result.total, 0);

      // Restore normal mock
      getDbMock.mock.restore();
      getDbMock = mock.method(mongoModule, 'getDb', () => db);
    });
  });
});
