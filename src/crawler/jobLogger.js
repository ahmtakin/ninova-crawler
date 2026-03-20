const { getDb } = require('../db/mongo');
const { COLLECTIONS } = require('../db/models');

/**
 * Create a job-scoped logger that writes to crawl_logs collection.
 * @param {import('mongodb').ObjectId} crawlJobId
 * @returns {{ info: Function, warn: Function, error: Function }}
 */
function createJobLogger(crawlJobId) {
  const db = getDb();
  const collection = db.collection(COLLECTIONS.CRAWL_LOGS);

  async function writeLog(level, message, meta = {}) {
    try {
      await collection.insertOne({
        crawlJobId,
        level,
        message,
        meta,
        timestamp: new Date()
      });
    } catch (error) {
      // Silently fail to avoid infinite loop if logging fails
      console.error('Failed to write log:', error.message);
    }
  }

  return {
    info: (message, meta) => writeLog('info', message, meta),
    warn: (message, meta) => writeLog('warn', message, meta),
    error: (message, meta) => writeLog('error', message, meta)
  };
}

module.exports = { createJobLogger };
