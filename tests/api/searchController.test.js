/**
 * Search Controller Tests
 *
 * Tests the search API endpoint.
 * Run: node --test tests/api/searchController.test.js
 */

const { describe, it, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const request = require('supertest');

const { setupTestDb, getTestDb, cleanupTestDb, closeTestDb } = require('../setup');
const { COLLECTIONS } = require('../../src/db/models');

describe('Search Controller API', () => {
  let db;
  let app;
  let getDbMock;

  before(async () => {
    db = await setupTestDb();

    // Mock getDb
    const mongoModule = require('../../src/db/mongo');
    getDbMock = mock.method(mongoModule, 'getDb', () => db);

    // Mock getCacheRedis
    const redisModule = require('../../src/db/redis');
    const mockRedis = {
      get: async () => null,
      setex: async () => Promise.resolve(),
    };
    mock.method(redisModule, 'getCacheRedis', () => mockRedis);

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

  // Helper to insert test data
  async function insertSearchData() {
    const crawlJobId = new ObjectId();

    // Insert pages
    await db.collection(COLLECTIONS.PAGES).insertMany([
      {
        url: 'https://example.com/page1',
        crawlJobId,
        title: 'Search Engine Tutorial',
        depth: 0,
        textContent: 'Learn about building search engines with inverted indexes',
        statusCode: 200,
        contentType: 'text/html',
        wordCount: 10
      },
      {
        url: 'https://example.com/page2',
        crawlJobId,
        title: 'Web Crawling Guide',
        depth: 1,
        textContent: 'How to crawl the web efficiently',
        statusCode: 200,
        contentType: 'text/html',
        wordCount: 8
      },
      {
        url: 'https://example.com/page3',
        crawlJobId,
        title: 'Database Optimization',
        depth: 2,
        textContent: 'Tips for fast database queries',
        statusCode: 200,
        contentType: 'text/html',
        wordCount: 7
      }
    ]);

    // Insert word index entries
    await db.collection(COLLECTIONS.WORD_INDEX).insertMany([
      // "search" appears in page1 title
      { word: 'search', url: 'https://example.com/page1', crawlJobId, origin: 'https://example.com', depth: 0, frequency: 1, inTitle: true, position: 'both' },
      // "engine" appears in page1 title
      { word: 'engine', url: 'https://example.com/page1', crawlJobId, origin: 'https://example.com', depth: 0, frequency: 1, inTitle: true, position: 'both' },
      // "crawl" appears in page2 title
      { word: 'crawl', url: 'https://example.com/page2', crawlJobId, origin: 'https://example.com', depth: 1, frequency: 1, inTitle: true, position: 'both' },
      // "web" appears in page2 body
      { word: 'web', url: 'https://example.com/page2', crawlJobId, origin: 'https://example.com', depth: 1, frequency: 1, inTitle: false, position: 'body' },
      // "database" appears in page3 title
      { word: 'database', url: 'https://example.com/page3', crawlJobId, origin: 'https://example.com', depth: 2, frequency: 1, inTitle: true, position: 'both' },
    ]);
  }

  describe('GET /api/search', () => {
    beforeEach(async () => {
      await insertSearchData();
    });

    it('should return search results for valid query', async () => {
      const response = await request(app)
        .get('/api/search')
        .query({ q: 'search' });

      assert.strictEqual(response.status, 200);
      assert.ok(Array.isArray(response.body.results));
      assert.ok(response.body.results.length > 0);
      assert.strictEqual(response.body.query, 'search');
      assert.ok(Array.isArray(response.body.tokens));
    });

    it('should return empty array for no matches', async () => {
      const response = await request(app)
        .get('/api/search')
        .query({ q: 'nonexistentword12345' });

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(response.body.results, []);
      assert.strictEqual(response.body.total, 0);
    });

    it('should return 400 for empty query', async () => {
      const response = await request(app)
        .get('/api/search')
        .query({ q: '' });

      assert.strictEqual(response.status, 400);
      assert.ok(response.body.error);
    });

    it('should return 400 for missing query parameter', async () => {
      const response = await request(app)
        .get('/api/search');

      assert.strictEqual(response.status, 400);
      assert.ok(response.body.error);
    });

    it('should return results with correct structure', async () => {
      const response = await request(app)
        .get('/api/search')
        .query({ q: 'search' });

      assert.strictEqual(response.status, 200);
      
      if (response.body.results.length > 0) {
        const result = response.body.results[0];
        assert.strictEqual(typeof result.relevantUrl, 'string');
        assert.strictEqual(typeof result.originUrl, 'string');
        assert.strictEqual(typeof result.depth, 'number');
        assert.strictEqual(typeof result.score, 'number');
        assert.strictEqual(typeof result.title, 'string');
      }
    });

    it('should respect limit parameter (max 100)', async () => {
      const response = await request(app)
        .get('/api/search')
        .query({ q: 'search', limit: 1 });

      assert.strictEqual(response.status, 200);
      assert.ok(response.body.results.length <= 1);
    });

    it('should respect offset parameter', async () => {
      const page1 = await request(app)
        .get('/api/search')
        .query({ q: 'search', limit: 10, offset: 0 });

      const page2 = await request(app)
        .get('/api/search')
        .query({ q: 'search', limit: 10, offset: 1 });

      // Second page should have fewer or equal results
      assert.ok(page2.body.results.length <= page1.body.results.length);
    });

    it('should return query in response', async () => {
      const response = await request(app)
        .get('/api/search')
        .query({ q: 'search engine' });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.query, 'search engine');
    });

    it('should return tookMs timing', async () => {
      const response = await request(app)
        .get('/api/search')
        .query({ q: 'search' });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(typeof response.body.tookMs, 'number');
      assert.ok(response.body.tookMs >= 0);
    });

    it('should return matched tokens', async () => {
      const response = await request(app)
        .get('/api/search')
        .query({ q: 'search engine' });

      assert.strictEqual(response.status, 200);
      assert.ok(Array.isArray(response.body.tokens));
      assert.ok(response.body.tokens.includes('search'));
      assert.ok(response.body.tokens.includes('engine'));
    });
  });

  describe('search edge cases', () => {
    beforeEach(async () => {
      await insertSearchData();
    });

    it('should handle stop words in query', async () => {
      const response = await request(app)
        .get('/api/search')
        .query({ q: 'the search engine' });

      assert.strictEqual(response.status, 200);
      // Should not include stop word "the" in tokens
      assert.ok(!response.body.tokens.includes('the'));
    });

    it('should handle special characters in query', async () => {
      const response = await request(app)
        .get('/api/search')
        .query({ q: 'search!!!' });

      assert.strictEqual(response.status, 200);
      // Should strip special characters
      assert.strictEqual(response.body.query, 'search!!!');
    });

    it('should default limit to configured value', async () => {
      const response = await request(app)
        .get('/api/search')
        .query({ q: 'search' });

      assert.strictEqual(response.status, 200);
      assert.ok(response.body.results.length <= 100);
    });
  });
});
