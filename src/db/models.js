/**
 * MongoDB collection definitions and index creation.
 *
 * Collections:
 *   crawl_jobs   — Crawl job metadata and stats
 *   pages        — Fetched page content and extracted data
 *   word_index   — Inverted index: word → page URL + frequency
 *   crawl_queue  — Persistent URL queue for resumability
 */

const COLLECTIONS = {
  CRAWL_JOBS: 'crawl_jobs',
  PAGES: 'pages',
  WORD_INDEX: 'word_index',
  CRAWL_QUEUE: 'crawl_queue',
};

/**
 * Create all required indexes on the database collections.
 * Idempotent — safe to call on every startup.
 * @param {import('mongodb').Db} db
 */
async function ensureIndexes(db) {
  try {
    // Crawl jobs collection
    const crawlJobs = db.collection(COLLECTIONS.CRAWL_JOBS);
    await crawlJobs.createIndex({ origin: 1, status: 1 });
    await crawlJobs.createIndex({ status: 1, createdAt: -1 });
    await crawlJobs.createIndex({ updatedAt: -1 });

    // Pages collection
    const pages = db.collection(COLLECTIONS.PAGES);
    await pages.createIndex({ url: 1, crawlJobId: 1 }, { unique: true });
    await pages.createIndex({ crawlJobId: 1, depth: 1 });
    await pages.createIndex({ indexedAt: 1 });
    await pages.createIndex({ crawlJobId: 1, url: 1 });

    // Word index collection
    const wordIndex = db.collection(COLLECTIONS.WORD_INDEX);
    await wordIndex.createIndex({ word: 1, crawlJobId: 1 });
    await wordIndex.createIndex({ word: 1 });
    await wordIndex.createIndex({ url: 1, crawlJobId: 1 });
    await wordIndex.createIndex({ crawlJobId: 1, word: 1 });

    // Crawl queue collection
    const crawlQueue = db.collection(COLLECTIONS.CRAWL_QUEUE);
    await crawlQueue.createIndex({ crawlJobId: 1, status: 1 });
    await crawlQueue.createIndex({ crawlJobId: 1, url: 1 }, { unique: true });
    await crawlQueue.createIndex({ status: 1, createdAt: 1 });

    const logger = require('../utils/logger');
    logger.info('All MongoDB indexes created successfully');
  } catch (error) {
    const logger = require('../utils/logger');
    logger.error('Failed to create indexes', { error: error.message });
    throw error;
  }
}

module.exports = { COLLECTIONS, ensureIndexes };
