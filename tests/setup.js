/**
 * Test Setup & Fixtures
 *
 * Provides utilities for testing the Ninova crawler:
 * - Test database connections (MongoDB & Redis)
 * - Test Express app creation
 * - Mock HTTP server for fetcher tests
 * - Sample HTML fixtures for parser tests
 * - Common test data fixtures
 *
 * Run: node --test tests/setup.test.js
 */

const { MongoClient } = require('mongodb');
const Redis = require('ioredis');
const http = require('http');
const https = require('https');
const express = require('express');
const { COLLECTIONS } = require('../src/db/models');
const { generateTestCertificate } = require('./utils/generateCert');

// ── Configuration ────────────────────────────────────────

const TEST_CONFIG = {
  // Use environment variables if available, otherwise use test defaults
  mongoUri: process.env.TEST_MONGO_URI || 'mongodb://localhost:27017/ninova_test',
  redisUrl: process.env.TEST_REDIS_URL || 'redis://localhost:6379/1', // DB 1 for tests
  testPort: 3001, // Port for test Express app
};

// ── Database Connection State ─────────────────────────────

let testMongoClient = null;
let testMongoDb = null;
let testRedisClient = null;
let mockServerInstance = null;
let testAppInstance = null;

// ── MongoDB Test Utilities ────────────────────────────────

/**
 * Connect to test MongoDB database and clean all collections.
 * Creates a fresh database state for each test run.
 *
 * @returns {Promise<import('mongodb').Db>} MongoDB database instance
 * @throws {Error} If connection fails
 */
async function setupTestDb() {
  if (testMongoClient && testMongoDb) {
    // Clean existing collections instead of reconnecting
    await cleanupTestDb();
    return testMongoDb;
  }

  try {
    testMongoClient = new MongoClient(TEST_CONFIG.mongoUri, {
      maxPoolSize: 5,
      minPoolSize: 1,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
    });

    await testMongoClient.connect();
    testMongoDb = testMongoClient.db();

    // Clean all collections before use
    await cleanupTestDb();

    return testMongoDb;
  } catch (error) {
    throw new Error(`Failed to setup test MongoDB: ${error.message}`);
  }
}

/**
 * Get the test database instance without reconnecting.
 *
 * @returns {import('mongodb').Db} MongoDB database instance
 * @throws {Error} If database not connected
 */
function getTestDb() {
  if (!testMongoDb) {
    throw new Error('Test MongoDB not connected. Call setupTestDb() first.');
  }
  return testMongoDb;
}

/**
 * Drop all test collections to clean up after tests.
 * Does not close the connection - use closeTestDb() for that.
 *
 * Design note: Uses deleteMany() instead of drop() to preserve collection
 * indexes. This is intentional for test performance - recreating indexes
 * for each test would be wasteful. Collections are effectively empty
 * after this operation.
 *
 * @returns {Promise<void>}
 */
async function cleanupTestDb() {
  if (!testMongoDb) {
    return;
  }

  try {
    const collections = await testMongoDb.listCollections().toArray();

    for (const collection of collections) {
      // Drop all collections except system collections
      if (!collection.name.startsWith('system.')) {
        await testMongoDb.collection(collection.name).deleteMany({});
      }
    }
  } catch (error) {
    // Log but don't throw - cleanup should be best-effort
    console.error('Error cleaning test database:', error.message);
  }
}

/**
 * Close the test MongoDB connection.
 *
 * @returns {Promise<void>}
 */
async function closeTestDb() {
  if (testMongoClient) {
    await testMongoClient.close();
    testMongoClient = null;
    testMongoDb = null;
  }
}

// ── Redis Test Utilities ──────────────────────────────────

/**
 * Connect to test Redis instance and flush all data.
 * Uses Redis DB 1 to avoid conflicts with development data.
 *
 * @returns {Promise<import('ioredis').Redis>} Redis client instance
 * @throws {Error} If connection fails
 */
async function setupTestRedis() {
  if (testRedisClient) {
    // Flush existing data instead of reconnecting
    await testRedisClient.flushdb();
    return testRedisClient;
  }

  try {
    testRedisClient = new Redis(TEST_CONFIG.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000),
      // Don't reconnect in tests - fail fast
      reconnectOnError: () => false,
    });

    // Wait for ready state with proper error handling
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Redis connection timeout'));
      }, 5000);

      const cleanup = () => {
        clearTimeout(timeout);
        testRedisClient.removeAllListeners('ready');
        testRedisClient.removeAllListeners('error');
      };

      testRedisClient.once('ready', () => {
        cleanup();
        resolve();
      });

      testRedisClient.once('error', (err) => {
        cleanup();
        reject(err);
      });
    });

    // Flush database to ensure clean state
    await testRedisClient.flushdb();

    return testRedisClient;
  } catch (error) {
    throw new Error(`Failed to setup test Redis: ${error.message}`);
  }
}

/**
 * Get the test Redis client without reconnecting.
 *
 * @returns {import('ioredis').Redis} Redis client instance
 * @throws {Error} If Redis not connected
 */
function getTestRedis() {
  if (!testRedisClient) {
    throw new Error('Test Redis not connected. Call setupTestRedis() first.');
  }
  return testRedisClient;
}

/**
 * Flush all data from test Redis and close connection.
 *
 * @returns {Promise<void>}
 */
async function closeTestRedis() {
  if (testRedisClient) {
    try {
      await testRedisClient.flushdb();
      await testRedisClient.quit();
    } catch (error) {
      // Ignore cleanup errors
      console.error('Error closing test Redis:', error.message);
    } finally {
      testRedisClient = null;
    }
  }
}

// ── Express App Test Utilities ────────────────────────────

/**
 * Create an Express app instance for API testing.
 * The app is not listening - use supertest to make requests.
 *
 * Note: This function implements a singleton pattern - it caches and returns
 * the same app instance on subsequent calls. This is intentional for test
 * performance, as creating a new app for each test would be wasteful.
 * If you need a fresh app instance, call cleanupAll() first.
 *
 * @param {Object} options - Configuration options
 * @param {boolean} options.withRoutes - Include API routes (default: true)
 * @param {boolean} options.withStatics - Include static file serving (default: false)
 * @returns {express.Application} Express app instance
 */
function createTestApp(options = {}) {
  const { withRoutes = true, withStatics = false } = options;

  // Return cached instance if available (singleton pattern)
  if (testAppInstance) {
    return testAppInstance;
  }

  const app = express();

  // Basic middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // CORS for testing
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Add API routes if requested
  if (withRoutes) {
    try {
      const apiRoutes = require('../src/api/routes');
      app.use('/api', apiRoutes);
    } catch (error) {
      console.warn('Could not load API routes:', error.message);
    }
  }

  // Add static file serving if requested
  if (withStatics) {
    const path = require('path');
    app.use(express.static(path.join(__dirname, '..', 'public')));
  }

  // Error handler
  app.use((err, req, res, _next) => {
    res.status(500).json({ error: err.message });
  });

  testAppInstance = app;
  return app;
}

// ── Mock HTTP Server Utilities ────────────────────────────

/**
 * Route definition for mock server.
 * @typedef {Object} MockRoute
 * @property {string} path - URL path (e.g., '/page1')
 * @property {number} status - HTTP status code
 * @property {string} [contentType] - Content-Type header
 * @property {string|Buffer} body - Response body
 * @property {Object} [headers] - Additional headers
 */

/**
 * Create a mock HTTP server for fetcher testing.
 * The server automatically assigns a random available port.
 *
 * @param {MockRoute[]} routes - Array of route definitions
 * @param {Object} options - Server options
 * @param {boolean} options.https - Use HTTPS instead of HTTP (default: false)
 * @param {string} options.tlsKey - TLS private key (for HTTPS, defaults to FIXTURES.tls.key)
 * @param {string} options.tlsCert - TLS certificate (for HTTPS, defaults to FIXTURES.tls.cert)
 * @returns {Promise<{server: http.Server|https.Server, url: string, port: number}>}
 */
function createMockServer(routes, options = {}) {
  return new Promise((resolve, reject) => {
    const { https: useHttps = false, tlsKey, tlsCert } = options;

    // Create Express app for the mock server
    const app = express();

    // Set up routes
    for (const route of routes) {
      app.all(route.path, (req, res) => {
        const status = route.status || 200;
        const contentType = route.contentType || 'text/html';
        const headers = route.headers || {};

        res.setHeader('Content-Type', contentType);
        Object.entries(headers).forEach(([key, value]) => {
          res.setHeader(key, value);
        });

        res.status(status).send(route.body);
      });
    }

    // Catch-all for undefined routes
    app.use((req, res) => {
      res.status(404).send('Not Found');
    });

    // Create server
    const server = useHttps
      ? https.createServer({
          key: tlsKey || FIXTURES.tls.key,
          cert: tlsCert || FIXTURES.tls.cert,
        }, app)
      : http.createServer(app);

    // Start server on random port
    server.listen(0, () => {
      const address = server.address();
      const port = address.port;
      const protocol = useHttps ? 'https' : 'http';
      const url = `${protocol}://localhost:${port}`;

      mockServerInstance = server;
      resolve({ server, url, port });
    });

    server.on('error', (error) => {
      reject(new Error(`Mock server error: ${error.message}`));
    });
  });
}

/**
 * Close the mock server if it's running.
 *
 * @returns {Promise<void>}
 */
async function closeMockServer() {
  if (mockServerInstance) {
    return new Promise((resolve) => {
      mockServerInstance.close(() => {
        mockServerInstance = null;
        resolve();
      });
    });
  }
}

// ── HTML Fixtures ──────────────────────────────────────────

/**
 * Get sample HTML for parser testing.
 *
 * @param {string} type - Type of HTML fixture to retrieve
 * @returns {string} HTML string
 */
function getSampleHtml(type) {
  const htmlFixtures = {
    // Simple page with basic links
    simple: `
      <!DOCTYPE html>
      <html>
        <head><title>Simple Page</title></head>
        <body>
          <a href="https://example.com/page1">Page 1</a>
          <a href="/about">About</a>
        </body>
      </html>
    `,

    // Complex page with various link types
    links: `
      <!DOCTYPE html>
      <html>
        <head><title>Links Page</title></head>
        <body>
          <a href="https://example.com/absolute">Absolute Link</a>
          <a href="/relative">Relative Link</a>
          <a href="../parent">Parent Link</a>
          <a href="javascript:void(0)">JavaScript</a>
          <a href="mailto:test@test.com">Email</a>
          <a href="#fragment">Fragment</a>
          <a href="tel:+1234567890">Phone</a>
          <a href="https://example.com/duplicate">Duplicate 1</a>
          <a href="https://example.com/duplicate">Duplicate 2</a>
          <a href='https://example.com/single-quoted'>Single Quote</a>
          <a href=https://example.com/no-quotes>No Quotes</a>
        </body>
      </html>
    `,

    // Page with meta tags
    meta: `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Meta Test Page</title>
          <meta name="description" content="This is a test description">
          <meta name="keywords" content="test, html, parser">
          <meta charset="UTF-8">
        </head>
        <body>
          <p>Some content</p>
        </body>
      </html>
    `,

    // Page with scripts and styles
    scripts: `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Scripts Page</title>
          <script>var secret = "hidden";</script>
          <style>.hidden { display: none; }</style>
        </head>
        <body>
          <script>console.log("more hidden");</script>
          <style>.more-hidden { color: red; }</style>
          <p>Visible content</p>
        </body>
      </html>
    `,

    // Page with HTML entities
    entities: `
      <!DOCTYPE html>
      <html>
        <head><title>Entities &amp; Special &lt;Chars&gt;</title></head>
        <body>
          <p>Tom &amp; Jerry &#169; 2024</p>
          <p>Less than: &lt; Greater than: &gt;</p>
          <p>Quote: &quot; Apostrophe: &#39;</p>
          <p>Nbsp: Before&nbsp;After</p>
        </body>
      </html>
    `,

    // Page with nested elements
    nested: `
      <!DOCTYPE html>
      <html>
        <head><title>Nested Elements</title></head>
        <body>
          <div>
            <section>
              <article>
                <p>Deep text</p>
              </article>
            </section>
          </div>
        </body>
      </html>
    `,

    // Empty or minimal page
    empty: `
      <!DOCTYPE html>
      <html>
        <body></body>
      </html>
    `,

    // Page with forms (to ensure form inputs are ignored)
    forms: `
      <!DOCTYPE html>
      <html>
        <head><title>Form Page</title></head>
        <body>
          <form action="/submit" method="POST">
            <input type="text" name="username" value="test">
            <input type="hidden" name="token" value="secret">
          </form>
        </body>
      </html>
    `,

    // Page with various content types
    content: `
      <!DOCTYPE html>
      <html>
        <head><title>Content Page</title></head>
        <body>
          <h1>Main Heading</h1>
          <h2>Subheading</h2>
          <p>Paragraph with <strong>bold</strong> and <em>italic</em> text.</p>
          <ul>
            <li>List item 1</li>
            <li>List item 2</li>
          </ul>
          <code>const x = 1;</code>
          <pre>Preformatted text</pre>
        </body>
      </html>
    `,

    // Page with redirects
    redirects: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta http-equiv="refresh" content="0; url=https://example.com/redirected">
          <title>Redirect Page</title>
        </head>
        <body>
          <p>Redirecting...</p>
        </body>
      </html>
    `,

    // Large page for testing size limits
    large: `
      <!DOCTYPE html>
      <html>
        <head><title>Large Page</title></head>
        <body>
          ${'<p>Content paragraph</p>'.repeat(1000)}
        </body>
      </html>
    `,
  };

  return htmlFixtures[type] || htmlFixtures.empty;
}

// ── Test Data Fixtures ────────────────────────────────────

/**
 * TLS certificate cache for testing.
 * Initialized once to avoid regenerating certificates for each test.
 */
let _tlsCache = null;

/**
 * Generate and cache TLS certificates for testing.
 *
 * This function should be called before accessing FIXTURES.tls to ensure
 * certificates are generated. The certificates are cached after first
 * generation to avoid regenerating them for each test.
 *
 * @returns {Promise<{key: string, cert: string}>} TLS key and certificate
 *
 * @example
 * ```javascript
 * // In test setup
 * await setupTestCertificates();
 *
 * // Certificates are now available via FIXTURES.tls
 * const { key, cert } = FIXTURES.tls;
 * ```
 */
async function setupTestCertificates() {
  if (_tlsCache) {
    return _tlsCache;
  }

  _tlsCache = await generateTestCertificate();
  return _tlsCache;
}

/**
 * Common test data fixtures.
 * Use these in your tests for consistency.
 */
const FIXTURES = Object.freeze({
  // ── URL Fixtures ────────────────────────────────────────

  urls: {
    // Valid URLs
    valid: [
      'https://example.com',
      'http://example.com',
      'https://example.com:8080/path',
      'https://example.com/path?query=1&sort=desc',
      'https://subdomain.example.com/path',
      'https://example.com/path#fragment',
    ],

    // Invalid URLs
    invalid: [
      'javascript:void(0)',
      'mailto:test@example.com',
      'tel:+1234567890',
      'ftp://example.com',
      '//example.com', // Protocol-relative
      'not-a-url',
      '',
    ],

    // Relative URLs
    relative: [
      '/path/to/page',
      'path/to/page',
      '../parent/page',
      './current/page',
      '?query=only',
      '#fragment-only',
    ],

    // URLs that should normalize to the same URL
    duplicates: [
      'https://example.com/path',
      'https://example.com/path/',
      'https://EXAMPLE.COM/path',
      'https://example.com:443/path',
      'https://example.com/path#fragment',
    ],

    // Test URLs for same-domain checking
    sameDomain: {
      origin: 'https://example.com',
      same: ['https://example.com/page1', 'https://example.com/page2'],
      different: ['https://other.com', 'https://sub.example.com'],
    },
  },

  // ── Crawl Job Fixtures ──────────────────────────────────

  jobs: {
    minimal: {
      origin: 'https://example.com',
      maxDepth: 2,
      status: 'queued',
      config: {
        maxQueueDepth: 1000,
        maxRequestsPerSecond: 5,
        maxConcurrentFetches: 3,
      },
      stats: {
        urlsQueued: 1,
        urlsProcessed: 0,
        urlsFailed: 0,
        pagesIndexed: 0,
        startedAt: null,
        completedAt: null,
        lastActivityAt: new Date(),
      },
    },

    running: {
      origin: 'https://example.com',
      maxDepth: 3,
      status: 'running',
      config: {
        maxQueueDepth: 10000,
        maxRequestsPerSecond: 10,
        maxConcurrentFetches: 5,
      },
      stats: {
        urlsQueued: 50,
        urlsProcessed: 25,
        urlsFailed: 2,
        pagesIndexed: 20,
        startedAt: new Date(Date.now() - 3600000), // 1 hour ago
        completedAt: null,
        lastActivityAt: new Date(),
      },
    },

    completed: {
      origin: 'https://example.com',
      maxDepth: 2,
      status: 'completed',
      config: {
        maxQueueDepth: 1000,
        maxRequestsPerSecond: 5,
        maxConcurrentFetches: 3,
      },
      stats: {
        urlsQueued: 10,
        urlsProcessed: 10,
        urlsFailed: 0,
        pagesIndexed: 10,
        startedAt: new Date(Date.now() - 7200000), // 2 hours ago
        completedAt: new Date(Date.now() - 3600000), // 1 hour ago
        lastActivityAt: new Date(Date.now() - 3600000),
      },
    },
  },

  // ── Page Fixtures ────────────────────────────────────────

  pages: {
    minimal: {
      url: 'https://example.com',
      crawlJobId: null, // Set in test
      origin: 'https://example.com',
      depth: 0,
      title: 'Example Page',
      statusCode: 200,
      contentType: 'text/html',
      textContent: 'Example content',
      links: ['https://example.com/page1'],
      wordCount: 2,
      fetchedAt: new Date(),
      indexedAt: null,
    },

    withContent: {
      url: 'https://example.com/article',
      crawlJobId: null,
      origin: 'https://example.com',
      depth: 1,
      title: 'Interesting Article',
      statusCode: 200,
      contentType: 'text/html',
      textContent: 'This is an interesting article about web crawling and search engines.',
      links: ['https://example.com/related', 'https://other.com/external'],
      wordCount: 12,
      fetchedAt: new Date(),
      indexedAt: null,
    },

    errorPage: {
      url: 'https://example.com/not-found',
      crawlJobId: null,
      origin: 'https://example.com',
      depth: 1,
      title: '',
      statusCode: 404,
      contentType: 'text/html',
      textContent: 'Page not found',
      links: [],
      wordCount: 3,
      fetchedAt: new Date(),
      indexedAt: null,
    },
  },

  // ── Word Index Fixtures ──────────────────────────────────

  wordIndex: {
    entries: [
      {
        word: 'crawling',
        url: 'https://example.com/article',
        crawlJobId: null,
        origin: 'https://example.com',
        depth: 0,
        frequency: 3,
        inTitle: false,
        position: 'body',
      },
      {
        word: 'search',
        url: 'https://example.com/article',
        crawlJobId: null,
        origin: 'https://example.com',
        depth: 0,
        frequency: 2,
        inTitle: true,
        position: 'both',
      },
    ],
  },

  // ── Crawl Queue Fixtures ─────────────────────────────────

  queue: {
    items: [
      {
        crawlJobId: null,
        url: 'https://example.com/page1',
        depth: 1,
        status: 'pending',
        createdAt: new Date(),
        processedAt: null,
      },
      {
        crawlJobId: null,
        url: 'https://example.com/page2',
        depth: 1,
        status: 'processing',
        createdAt: new Date(Date.now() - 1000),
        processedAt: new Date(),
      },
    ],
  },

  // ── Mock Server Routes ───────────────────────────────────

  mockRoutes: {
    success: [
      {
        path: '/page1',
        status: 200,
        contentType: 'text/html',
        body: getSampleHtml('simple'),
      },
      {
        path: '/links',
        status: 200,
        contentType: 'text/html',
        body: getSampleHtml('links'),
      },
    ],

    redirects: [
      {
        path: '/redirect',
        status: 301,
        headers: { Location: '/target' },
        body: 'Redirecting',
      },
      {
        path: '/target',
        status: 200,
        contentType: 'text/html',
        body: '<html><body>Target page</body></html>',
      },
    ],

    errors: [
      {
        path: '/404',
        status: 404,
        contentType: 'text/html',
        body: '<html><body>Not Found</body></html>',
      },
      {
        path: '/500',
        status: 500,
        contentType: 'text/html',
        body: '<html><body>Internal Server Error</body></html>',
      },
    ],

    timeout: [
      {
        path: '/timeout',
        status: 200,
        body: 'Delayed response',
      },
    ],

    large: [
      {
        path: '/large',
        status: 200,
        contentType: 'text/html',
        body: getSampleHtml('large'),
      },
    ],
  },

  // ── TLS Certificates for HTTPS Mock Server ──────────────
  // Dynamically generated certificates for testing.
  // Call setupTestCertificates() before accessing this property.

  get tls() {
    if (!_tlsCache) {
      throw new Error(
        'TLS certificates not initialized. Call setupTestCertificates() before accessing FIXTURES.tls'
      );
    }
    return _tlsCache;
  },

  // ── Search Query Fixtures ─────────────────────────────────

  search: {
    queries: {
      single: 'crawling',
      multiple: 'web search engine',
      phrase: 'web crawler',
      empty: '',
      onlyStopWords: 'the a an is',
    },

    expectedResults: {
      // Define expected search results for validation
      crawling: [
        { url: 'https://example.com/article', score: 3 },
      ],
    },
  },

  // ── Stop Words for Search ────────────────────────────────

  stopWords: new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
    'to', 'was', 'were', 'will', 'with', 'this', 'but', 'they',
    'have', 'had', 'what', 'when', 'where', 'who', 'which', 'why', 'how',
    'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
    'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
    'than', 'too', 'very', 'can', 'just', 'should', 'now', 'i', 'you',
    'your', 'we', 'our', 'their', 'them', 'his', 'her', 'him', 'me',
    'my', 'ours', 'yours', 'mine', 'hers', 'theirs', 'us',
  ]),
});

// ── Cleanup Helper ────────────────────────────────────────

/**
 * Clean up all test resources (DB, Redis, mock server).
 * Call this in after() hooks or test teardown.
 *
 * @returns {Promise<void>}
 */
async function cleanupAll() {
  await Promise.allSettled([
    cleanupTestDb(),
    closeTestRedis(),
    closeMockServer(),
  ]);

  testAppInstance = null;
}

// ── Self-Test ──────────────────────────────────────────────

/**
 * Run a simple test to verify setup utilities work.
 * This runs only when this file is executed directly.
 */
async function selfTest() {
  console.log('Running setup utilities self-test...\n');

  try {
    // Test MongoDB
    console.log('1. Testing MongoDB connection...');
    const db = await setupTestDb();
    const collections = await db.listCollections().toArray();
    console.log(`   ✓ Connected to MongoDB, found ${collections.length} collections`);

    // Test Redis
    console.log('2. Testing Redis connection...');
    const redis = await setupTestRedis();
    await redis.set('test_key', 'test_value');
    const value = await redis.get('test_key');
    console.log(`   ✓ Connected to Redis, set/get works: ${value === 'test_value'}`);

    // Test TLS certificate generation
    console.log('3. Testing TLS certificate generation...');
    await setupTestCertificates();
    console.log(`   ✓ TLS certificates generated: ${FIXTURES.tls.key.length} bytes key, ${FIXTURES.tls.cert.length} bytes cert`);

    // Test mock server
    console.log('4. Testing mock server...');
    const { server, url } = await createMockServer([
      { path: '/test', status: 200, body: 'Test response' },
    ]);
    console.log(`   ✓ Mock server running on ${url}`);

    // Test HTML fixtures
    console.log('5. Testing HTML fixtures...');
    const html = getSampleHtml('simple');
    console.log(`   ✓ Sample HTML length: ${html.length} chars`);

    // Test fixtures
    console.log('6. Testing fixtures...');
    console.log(`   ✓ Valid URLs: ${FIXTURES.urls.valid.length}`);
    console.log(`   ✓ Stop words: ${FIXTURES.stopWords.size}`);

    // Cleanup
    console.log('\n7. Cleaning up...');
    await cleanupAll();
    console.log('   ✓ All resources cleaned up');

    console.log('\n✅ All self-tests passed!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Self-test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run self-test if executed directly
if (require.main === module) {
  selfTest();
}

// ── Exports ────────────────────────────────────────────────

module.exports = {
  // Configuration
  TEST_CONFIG,

  // MongoDB utilities
  setupTestDb,
  getTestDb,
  cleanupTestDb,
  closeTestDb,

  // Redis utilities
  setupTestRedis,
  getTestRedis,
  closeTestRedis,

  // Express utilities
  createTestApp,

  // Mock server utilities
  createMockServer,
  closeMockServer,

  // HTML fixtures
  getSampleHtml,

  // Test data fixtures
  FIXTURES,

  // TLS certificate utilities
  setupTestCertificates,

  // General cleanup
  cleanupAll,
};
