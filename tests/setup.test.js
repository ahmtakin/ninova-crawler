/**
 * Setup Utilities Tests
 *
 * Verifies that the test setup utilities work correctly.
 * Run: node --test tests/setup.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  setupTestDb,
  getTestDb,
  cleanupTestDb,
  closeTestDb,
  setupTestRedis,
  getTestRedis,
  closeTestRedis,
  createTestApp,
  createMockServer,
  closeMockServer,
  getSampleHtml,
  FIXTURES,
  cleanupAll,
  TEST_CONFIG,
} = require('./setup');

describe('Test Setup & Fixtures', () => {
  describe('Configuration', () => {
    it('should have test configuration', () => {
      assert.strictEqual(typeof TEST_CONFIG.mongoUri, 'string');
      assert.strictEqual(typeof TEST_CONFIG.redisUrl, 'string');
      assert.strictEqual(typeof TEST_CONFIG.testPort, 'number');
    });
  });

  describe('MongoDB Utilities', () => {
    let db;

    before(async () => {
      db = await setupTestDb();
    });

    after(async () => {
      await closeTestDb();
    });

    it('should connect to test MongoDB', () => {
      assert.ok(db);
      assert.strictEqual(db.databaseName, 'ninova_test');
    });

    it('should get same database instance', () => {
      const sameDb = getTestDb();
      assert.strictEqual(sameDb, db);
    });

    it('should clean collections', async () => {
      // Insert test data
      const collection = db.collection('test_collection');
      await collection.insertOne({ test: 'data' });
      const countBefore = await collection.countDocuments();
      assert.ok(countBefore > 0);

      // Clean
      await cleanupTestDb();
      const countAfter = await collection.countDocuments();
      assert.strictEqual(countAfter, 0);
    });
  });

  describe('Redis Utilities', () => {
    let redis;

    after(async () => {
      await closeTestRedis();
    });

    it('should connect to test Redis', async () => {
      redis = await setupTestRedis();
      assert.ok(redis);
      assert.ok(redis.status === 'ready');
    });

    it('should get same Redis instance', () => {
      const sameRedis = getTestRedis();
      assert.strictEqual(sameRedis, redis);
    });

    it('should flush data on setup', async () => {
      await redis.set('test_key', 'test_value');
      const value = await redis.get('test_key');
      assert.strictEqual(value, 'test_value');

      // Setup again should flush
      await setupTestRedis();
      const valueAfter = await redis.get('test_key');
      assert.strictEqual(valueAfter, null);
    });
  });

  describe('Express App Utilities', () => {
    it('should create test app without routes', () => {
      const app = createTestApp({ withRoutes: false });
      assert.ok(app);
      assert.strictEqual(typeof app, 'function');
    });

    it('should create test app with routes', () => {
      const app = createTestApp({ withRoutes: true });
      assert.ok(app);
    });
  });

  describe('Mock Server Utilities', () => {
    let mockServer;

    after(async () => {
      await closeMockServer();
    });

    it('should create HTTP mock server', async () => {
      mockServer = await createMockServer([
        { path: '/test', status: 200, body: 'Hello World' },
      ]);

      assert.ok(mockServer.server);
      assert.ok(mockServer.url);
      assert.ok(mockServer.port);
      assert.ok(mockServer.url.startsWith('http://'));
    });

    it('should return correct response from mock server', async () => {
      const response = await fetch(`${mockServer.url}/test`);
      const text = await response.text();
      assert.strictEqual(text, 'Hello World');
    });

    it('should return 404 for undefined routes', async () => {
      const response = await fetch(`${mockServer.url}/undefined`);
      assert.strictEqual(response.status, 404);
    });
  });

  describe('HTML Fixtures', () => {
    it('should return simple HTML fixture', () => {
      const html = getSampleHtml('simple');
      assert.ok(html.includes('<title>Simple Page</title>'));
      assert.ok(html.includes('https://example.com/page1'));
    });

    it('should return links HTML fixture', () => {
      const html = getSampleHtml('links');
      assert.ok(html.includes('javascript:void(0)'));
      assert.ok(html.includes('mailto:test@test.com'));
    });

    it('should return meta HTML fixture', () => {
      const html = getSampleHtml('meta');
      assert.ok(html.includes('name="description"'));
      assert.ok(html.includes('This is a test description'));
    });

    it('should return scripts HTML fixture', () => {
      const html = getSampleHtml('scripts');
      assert.ok(html.includes('<script>'));
      assert.ok(html.includes('<style>'));
    });

    it('should return entities HTML fixture', () => {
      const html = getSampleHtml('entities');
      assert.ok(html.includes('&amp;'));
      assert.ok(html.includes('&lt;'));
    });

    it('should return empty HTML for unknown type', () => {
      const html = getSampleHtml('unknown');
      assert.ok(html.includes('<html>'));
    });
  });

  describe('Fixtures', () => {
    it('should have URL fixtures', () => {
      assert.ok(Array.isArray(FIXTURES.urls.valid));
      assert.ok(Array.isArray(FIXTURES.urls.invalid));
      assert.ok(Array.isArray(FIXTURES.urls.relative));
      assert.ok(Array.isArray(FIXTURES.urls.duplicates));
      assert.ok(FIXTURES.urls.sameDomain);
    });

    it('should have valid URL fixtures', () => {
      assert.ok(FIXTURES.urls.valid.length > 0);
      assert.ok(FIXTURES.urls.valid.every(u => u.startsWith('http')));
    });

    it('should have invalid URL fixtures', () => {
      assert.ok(FIXTURES.urls.invalid.length > 0);
      assert.ok(FIXTURES.urls.invalid.includes('javascript:void(0)'));
    });

    it('should have job fixtures', () => {
      assert.ok(FIXTURES.jobs.minimal);
      assert.ok(FIXTURES.jobs.running);
      assert.ok(FIXTURES.jobs.completed);
      assert.strictEqual(FIXTURES.jobs.minimal.status, 'queued');
      assert.strictEqual(FIXTURES.jobs.running.status, 'running');
      assert.strictEqual(FIXTURES.jobs.completed.status, 'completed');
    });

    it('should have page fixtures', () => {
      assert.ok(FIXTURES.pages.minimal);
      assert.ok(FIXTURES.pages.withContent);
      assert.ok(FIXTURES.pages.errorPage);
      assert.strictEqual(FIXTURES.pages.minimal.statusCode, 200);
      assert.strictEqual(FIXTURES.pages.errorPage.statusCode, 404);
    });

    it('should have word index fixtures', () => {
      assert.ok(Array.isArray(FIXTURES.wordIndex.entries));
      assert.ok(FIXTURES.wordIndex.entries.length > 0);
    });

    it('should have mock route fixtures', () => {
      assert.ok(FIXTURES.mockRoutes.success);
      assert.ok(FIXTURES.mockRoutes.redirects);
      assert.ok(FIXTURES.mockRoutes.errors);
    });

    it('should have stop words fixture', () => {
      assert.ok(FIXTURES.stopWords instanceof Set);
      assert.ok(FIXTURES.stopWords.has('the'));
      assert.ok(FIXTURES.stopWords.has('and'));
    });

    it('should have search query fixtures', () => {
      assert.ok(FIXTURES.search.queries.single);
      assert.ok(FIXTURES.search.queries.multiple);
    });
  });

  describe('Cleanup All', () => {
    it('should cleanup all resources without error', async () => {
      // Setup some resources
      await setupTestDb();
      await setupTestRedis();
      await createMockServer([{ path: '/', status: 200, body: 'OK' }]);

      // Cleanup should not throw
      await assert.doesNotReject(cleanupAll());
    });
  });
});
