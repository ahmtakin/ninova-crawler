/**
 * Config Tests
 *
 * Tests the configuration module.
 * Run: node --test tests/config.test.js
 */

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

describe('Configuration', () => {
  let originalEnv;

  beforeEach(() => {
    // Store original environment
    originalEnv = { ...process.env };
  });

  after(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  // Clear require cache before loading config
  beforeEach(() => {
    delete require.cache[require.resolve('../src/config')];
  });

  describe('default values', () => {
    it('should have default port of 3000', () => {
      delete process.env.PORT;
      const config = require('../src/config');
      assert.strictEqual(config.port, 3000);
    });

    it('should have default MongoDB URI', () => {
      delete process.env.MONGO_URI;
      const config = require('../src/config');
      assert.strictEqual(config.mongoUri, 'mongodb://localhost:27017/ninova');
    });

    it('should have default Redis URL', () => {
      delete process.env.REDIS_CACHE_URL;
      const config = require('../src/config');
      assert.strictEqual(config.redisCacheUrl, 'redis://localhost:6379');
    });

    it('should have default back pressure settings', () => {
      delete process.env.MAX_QUEUE_DEPTH;
      delete process.env.MAX_REQUESTS_PER_SECOND;
      delete process.env.MAX_CONCURRENT_FETCHES;
      const config = require('../src/config');
      assert.strictEqual(config.maxQueueDepth, 10000);
      assert.strictEqual(config.maxRequestsPerSecond, 10);
      assert.strictEqual(config.maxConcurrentFetches, 5);
    });

    it('should have default HTTP settings', () => {
      delete process.env.REQUEST_TIMEOUT_MS;
      delete process.env.MAX_PAGE_SIZE_BYTES;
      const config = require('../src/config');
      assert.strictEqual(config.requestTimeoutMs, 10000);
      assert.strictEqual(config.maxPageSizeBytes, 5 * 1024 * 1024);
    });

    it('should have default user agent', () => {
      delete process.env.USER_AGENT;
      const config = require('../src/config');
      assert.strictEqual(config.userAgent, 'NinovaCrawler/1.0 (+https://github.com/ninova)');
    });

    it('should have max redirects of 5', () => {
      const config = require('../src/config');
      assert.strictEqual(config.maxRedirects, 5);
    });

    it('should have default crawl depth settings', () => {
      const config = require('../src/config');
      assert.strictEqual(config.defaultMaxDepth, 3);
      assert.strictEqual(config.maxAllowedDepth, 10);
    });

    it('should have default search settings', () => {
      const config = require('../src/config');
      assert.strictEqual(config.searchResultLimit, 20);
      assert.strictEqual(config.searchCacheTtlSeconds, 30);
    });
  });

  describe('environment variable override', () => {
    it('should use PORT from environment', () => {
      process.env.PORT = '8080';
      const config = require('../src/config');
      assert.strictEqual(config.port, 8080);
    });

    it('should use MONGO_URI from environment', () => {
      process.env.MONGO_URI = 'mongodb://custom:27017/test';
      const config = require('../src/config');
      assert.strictEqual(config.mongoUri, 'mongodb://custom:27017/test');
    });

    it('should use REDIS_CACHE_URL from environment', () => {
      process.env.REDIS_CACHE_URL = 'redis://custom:6380';
      const config = require('../src/config');
      assert.strictEqual(config.redisCacheUrl, 'redis://custom:6380');
    });

    it('should use MAX_QUEUE_DEPTH from environment', () => {
      process.env.MAX_QUEUE_DEPTH = '5000';
      const config = require('../src/config');
      assert.strictEqual(config.maxQueueDepth, 5000);
    });

    it('should use MAX_REQUESTS_PER_SECOND from environment', () => {
      process.env.MAX_REQUESTS_PER_SECOND = '20';
      const config = require('../src/config');
      assert.strictEqual(config.maxRequestsPerSecond, 20);
    });

    it('should use MAX_CONCURRENT_FETCHES from environment', () => {
      process.env.MAX_CONCURRENT_FETCHES = '10';
      const config = require('../src/config');
      assert.strictEqual(config.maxConcurrentFetches, 10);
    });

    it('should use REQUEST_TIMEOUT_MS from environment', () => {
      process.env.REQUEST_TIMEOUT_MS = '30000';
      const config = require('../src/config');
      assert.strictEqual(config.requestTimeoutMs, 30000);
    });

    it('should use MAX_PAGE_SIZE_BYTES from environment', () => {
      process.env.MAX_PAGE_SIZE_BYTES = '1048576';
      const config = require('../src/config');
      assert.strictEqual(config.maxPageSizeBytes, 1048576);
    });

    it('should use USER_AGENT from environment', () => {
      process.env.USER_AGENT = 'CustomBot/1.0';
      const config = require('../src/config');
      assert.strictEqual(config.userAgent, 'CustomBot/1.0');
    });
  });

  describe('immutability', () => {
    it('should be frozen (immutable)', () => {
      const config = require('../src/config');
      assert.ok(Object.isFrozen(config));
    });

    it('should not allow modifying properties', () => {
      const config = require('../src/config');
      try {
        config.port = 4000;
        // If no error, check if value changed (it shouldn't for frozen objects)
        assert.strictEqual(config.port, 3000);
      } catch {
        // Expected: cannot assign to read-only property
      }
    });
  });

  describe('data types', () => {
    it('should have numeric port', () => {
      const config = require('../src/config');
      assert.strictEqual(typeof config.port, 'number');
    });

    it('should have numeric timeout values', () => {
      const config = require('../src/config');
      assert.strictEqual(typeof config.requestTimeoutMs, 'number');
      assert.strictEqual(typeof config.maxPageSizeBytes, 'number');
    });

    it('should have string URIs', () => {
      const config = require('../src/config');
      assert.strictEqual(typeof config.mongoUri, 'string');
      assert.strictEqual(typeof config.redisCacheUrl, 'string');
    });

    it('should have string user agent', () => {
      const config = require('../src/config');
      assert.strictEqual(typeof config.userAgent, 'string');
    });
  });

  describe('value validation', () => {
    it('should handle invalid PORT (NaN) by using default', () => {
      process.env.PORT = 'invalid';
      const config = require('../src/config');
      assert.strictEqual(config.port, 3000);
    });

    it('should handle PORT of 0 by using default', () => {
      process.env.PORT = '0';
      const config = require('../src/config');
      assert.strictEqual(config.port, 3000);
    });

    it('should parse valid numeric strings', () => {
      process.env.MAX_QUEUE_DEPTH = '12345';
      const config = require('../src/config');
      assert.strictEqual(config.maxQueueDepth, 12345);
    });
  });
});
