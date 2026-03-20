/**
 * Search Engine — queries the inverted word index and ranks results.
 *
 * Scoring heuristic:
 *   score = Σ(frequency) × title_bonus × multi_word_bonus / (depth + 1)
 *   - title_bonus: 3× if word appears in title
 *   - multi_word_bonus: count of distinct query words matched
 *   - depth_penalty: shallower pages rank higher
 *
 * Search works concurrently with active crawling — reads from MongoDB
 * which handles concurrent reads during writes.
 */

const { COLLECTIONS } = require('../db/models');
const { getDb } = require('../db/mongo');
const { getCacheRedis } = require('../db/redis');
const { tokenize } = require('./indexer');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Search the indexed pages for a given query.
 *
 * @param {string} query - User's search query
 * @param {object} [options]
 * @param {number} [options.limit=20] - Max results to return
 * @param {number} [options.offset=0] - Pagination offset
 * @param {string} [options.crawlJobId] - Optional: filter to a specific crawl job
 * @returns {Promise<{results: Array<{relevantUrl: string, originUrl: string, depth: number, score: number, title: string}>, total: number, tookMs: number, query: string, tokens: string[]}>}
 */
async function search(query, options = {}) {
  const startTime = Date.now();
  const limit = Math.min(options.limit || config.searchResultLimit, 100);
  const offset = options.offset || 0;

  try {
    // 1. Tokenize the query
    const tokens = tokenize(query);

    if (tokens.length === 0) {
      return {
        results: [],
        total: 0,
        tookMs: Date.now() - startTime,
        query,
        tokens: []
      };
    }

    // 2. Check Redis cache (optional)
    const cacheRedis = getCacheRedis();
    const cacheKey = `search:${JSON.stringify({ q: query, tokens: tokens.sort(), jobId: options.crawlJobId || 'all' })}`;

    try {
      const cached = await cacheRedis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Cache miss or error, continue with search
    }

    const db = getDb();

    // 3. Query word_index collection
    const mongoQuery = {
      word: { $in: tokens }
    };

    if (options.crawlJobId) {
      const { ObjectId } = require('mongodb');
      mongoQuery.crawlJobId = new ObjectId(options.crawlJobId);
    }

    const wordEntries = await db.collection(COLLECTIONS.WORD_INDEX)
      .find(mongoQuery)
      .toArray();

    if (wordEntries.length === 0) {
      return {
        results: [],
        total: 0,
        tookMs: Date.now() - startTime,
        query,
        tokens
      };
    }

    // 4. Group results by URL and calculate scores
    const urlScores = new Map();

    for (const entry of wordEntries) {
      const url = entry.url;

      if (!urlScores.has(url)) {
        urlScores.set(url, {
          totalFrequency: 0,
          titleMatches: 0,
          matchedWords: new Set(),
          origin: entry.origin,
          depth: entry.depth
        });
      }

      const score = urlScores.get(url);
      score.totalFrequency += entry.frequency;
      if (entry.inTitle) score.titleMatches += 1;
      score.matchedWords.add(entry.word);
    }

    // 5. Calculate final scores and sort
    const results = [];

    for (const [url, data] of urlScores.entries()) {
      const titleBonus = data.titleMatches > 0 ? 3 : 1;
      const multiWordBonus = data.matchedWords.size;
      const depthPenalty = 1 / (data.depth + 1);

      const score = data.totalFrequency * titleBonus * multiWordBonus * depthPenalty;

      results.push({
        relevantUrl: url,
        originUrl: data.origin,
        depth: data.depth,
        score: Math.round(score * 1000) / 1000 // Round to 3 decimals
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    const total = results.length;

    // Apply pagination
    const paginatedResults = results.slice(offset, offset + limit);

    // 6. Fetch page titles for display
    const urls = paginatedResults.map(r => r.relevantUrl);
    const pages = await db.collection(COLLECTIONS.PAGES)
      .find({ url: { $in: urls } })
      .project({ url: 1, title: 1 })
      .toArray();

    const titleMap = new Map(pages.map(p => [p.url, p.title || '']));

    // Add titles to results
    for (const result of paginatedResults) {
      result.title = titleMap.get(result.relevantUrl) || '';
    }

    const response = {
      results: paginatedResults,
      total,
      tookMs: Date.now() - startTime,
      query,
      tokens
    };

    // 7. Cache results in Redis with TTL
    try {
      await cacheRedis.setex(cacheKey, config.searchCacheTtlSeconds, JSON.stringify(response));
    } catch {
      // Cache write failed, but we have the results
    }

    return response;

  } catch (error) {
    logger.error('Search error', { query, error: error.message });
    return {
      results: [],
      total: 0,
      tookMs: Date.now() - startTime,
      query,
      tokens: []
    };
  }
}

module.exports = { search };
