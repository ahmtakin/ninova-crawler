/**
 * Search Controller — handles search queries against the indexed pages.
 *
 * Endpoint:
 *   GET /api/search?q=<query>&limit=20&offset=0&jobId=<optional>
 */

const { search } = require('../search/searcher');
const logger = require('../utils/logger');

/**
 * GET /api/search
 * Search indexed pages.
 * Query params:
 *   q      — Search query (required)
 *   limit  — Max results (default 20)
 *   offset — Pagination offset (default 0)
 *   jobId  — Filter to a specific crawl job (optional)
 */
async function searchPages(req, res) {
  try {
    const { q, limit, offset, jobId } = req.query;

    // Validate query
    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    // Parse limit
    let parsedLimit = 20;
    if (limit !== undefined) {
      parsedLimit = parseInt(limit, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        return res.status(400).json({ error: 'Limit must be between 1 and 100' });
      }
    }

    // Parse offset
    let parsedOffset = 0;
    if (offset !== undefined) {
      parsedOffset = parseInt(offset, 10);
      if (isNaN(parsedOffset) || parsedOffset < 0) {
        return res.status(400).json({ error: 'Offset must be a non-negative integer' });
      }
    }

    const options = {
      limit: parsedLimit,
      offset: parsedOffset
    };

    if (jobId) {
      options.crawlJobId = jobId;
    }

    const results = await search(q.trim(), options);

    res.json(results);

  } catch (error) {
    logger.error('Error searching', { error: error.message });
    res.status(500).json({ error: 'Search failed' });
  }
}

module.exports = { searchPages };
