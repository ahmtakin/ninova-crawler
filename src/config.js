/**
 * Central configuration — reads from environment with sensible defaults.
 * All crawler, DB, and back-pressure settings live here.
 */

const config = Object.freeze({
  port: parseInt(process.env.PORT, 10) || 3000,

  // Database
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/ninova',
  redisQueueUrl: process.env.REDIS_QUEUE_URL || 'redis://localhost:6379',
  redisCacheUrl: process.env.REDIS_CACHE_URL || 'redis://localhost:6380',

  // Back pressure
  maxQueueDepth: parseInt(process.env.MAX_QUEUE_DEPTH, 10) || 10000,
  maxRequestsPerSecond: parseInt(process.env.MAX_REQUESTS_PER_SECOND, 10) || 10,
  maxConcurrentFetches: parseInt(process.env.MAX_CONCURRENT_FETCHES, 10) || 5,

  // HTTP fetching
  requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 10000,
  maxPageSizeBytes: parseInt(process.env.MAX_PAGE_SIZE_BYTES, 10) || 5 * 1024 * 1024,
  userAgent: process.env.USER_AGENT || 'NinovaCrawler/1.0 (+https://github.com/ninova)',
  maxRedirects: 5,

  // Crawl defaults
  defaultMaxDepth: 3,
  maxAllowedDepth: 10,

  // Search
  searchResultLimit: 20,
  searchCacheTtlSeconds: 30,
});

module.exports = config;
