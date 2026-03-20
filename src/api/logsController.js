/**
 * Logs API Controller
 *
 * Provides GET /api/logs/:jobId endpoint for fetching paginated
 * crawl job logs with optional filtering by log level.
 */

const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db/mongo');
const { COLLECTIONS } = require('../db/models');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/logs/:jobId
 *
 * Fetch paginated logs for a specific crawl job.
 *
 * Query params:
 *   - limit: number of logs to return (default: 100, max: 500)
 *   - offset: number of logs to skip (default: 0)
 *   - level: filter by log level 'info', 'warn', or 'error' (optional)
 *
 * Response:
 *   {
 *     logs: Array of log entries,
 *     total: total number of logs matching filter,
 *     limit: actual limit used,
 *     offset: actual offset used
 *   }
 */
async function getJobLogs(req, res) {
  try {
    const { jobId } = req.params;

    // Parse and validate query parameters
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;
    const level = req.query.level;

    // Validate ObjectId format
    if (!ObjectId.isValid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }

    const db = getDb();

    // Build filter object
    const filter = { crawlJobId: new ObjectId(jobId) };

    // Add level filter if provided and valid
    if (level && ['info', 'warn', 'error'].includes(level)) {
      filter.level = level;
    }

    // Fetch paginated logs, sorted by most recent first
    const logs = await db.collection(COLLECTIONS.CRAWL_LOGS)
      .find(filter)
      .sort({ timestamp: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    // Get total count for pagination
    const total = await db.collection(COLLECTIONS.CRAWL_LOGS).countDocuments(filter);

    // Return paginated response
    res.json({
      logs,
      total,
      offset,
      limit
    });

  } catch (error) {
    logger.error('Error fetching logs', { error: error.message, jobId: req.params.jobId });
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
}

// Mount routes
router.get('/:jobId', getJobLogs);

module.exports = router;
