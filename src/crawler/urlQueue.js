/**
 * Persistent URL queue backed by MongoDB.
 * Supports resumability — queue state survives server restarts.
 * Uses Redis for fast visited-URL deduplication.
 */

const { ObjectId } = require('mongodb');
const { COLLECTIONS } = require('../db/models');
const logger = require('../utils/logger');

class UrlQueue {
  /**
   * @param {import('mongodb').Db} db - MongoDB database
   * @param {import('ioredis').Redis} cacheRedis - Redis for visited set
   * @param {ObjectId} crawlJobId - The crawl job this queue belongs to
   */
  constructor(db, cacheRedis, crawlJobId) {
    this.db = db;
    this.cacheRedis = cacheRedis;
    this.crawlJobId = crawlJobId;
    this.collection = db.collection(COLLECTIONS.CRAWL_QUEUE);
    this.visitedKey = `visited:${crawlJobId.toString()}`;
  }

  /**
   * Add a URL to the queue if not already visited.
   * Uses Redis SADD for O(1) dedup, MongoDB for persistence.
   * @param {string} url - Normalized URL
   * @param {number} depth - Depth at which this URL was discovered
   * @returns {Promise<boolean>} true if added (new URL), false if duplicate
   */
  async enqueue(url, depth) {
    try {
      // Check if URL already visited using Redis SADD
      const isNew = await this.cacheRedis.sadd(this.visitedKey, url);

      if (isNew === 0) {
        return false; // Already visited/queued
      }

      // Insert into MongoDB for persistence
      await this.collection.insertOne({
        crawlJobId: this.crawlJobId,
        url,
        depth,
        status: 'pending',
        createdAt: new Date(),
        processedAt: null
      });

      return true;
    } catch (error) {
      logger.error('Error enqueuing URL', { url, error: error.message });
      return false;
    }
  }

  /**
   * Fetch the next batch of pending URLs and mark them as "processing".
   * Uses findOneAndUpdate for atomic claim to prevent double-processing.
   * @param {number} batchSize - Max URLs to dequeue
   * @returns {Promise<Array<{url: string, depth: number, _id: ObjectId}>>}
   */
  async dequeueBatch(batchSize) {
    try {
      const items = [];

      // Find pending URLs sorted by depth (BFS)
      const pendingItems = await this.collection
        .find({
          crawlJobId: this.crawlJobId,
          status: 'pending'
        })
        .sort({ depth: 1, createdAt: 1 })
        .limit(batchSize)
        .toArray();

      // Atomically claim each item
      for (const item of pendingItems) {
        const result = await this.collection.findOneAndUpdate(
          { _id: item._id, status: 'pending' },
          { $set: { status: 'processing' } },
          { returnDocument: 'after' }
        );

        if (result && result.status === 'processing') {
          items.push({
            _id: result._id,
            url: result.url,
            depth: result.depth
          });
        }
      }

      return items;
    } catch (error) {
      logger.error('Error dequeuing batch', { error: error.message });
      return [];
    }
  }

  /**
   * Mark a URL as done.
   * @param {ObjectId} queueItemId
   */
  async markDone(queueItemId) {
    try {
      await this.collection.updateOne(
        { _id: queueItemId },
        {
          $set: {
            status: 'done',
            processedAt: new Date()
          }
        }
      );
    } catch (error) {
      logger.error('Error marking URL as done', { error: error.message });
    }
  }

  /**
   * Mark a URL as failed.
   * @param {ObjectId} queueItemId
   * @param {string} error - Error message
   */
  async markFailed(queueItemId, error) {
    try {
      await this.collection.updateOne(
        { _id: queueItemId },
        {
          $set: {
            status: 'failed',
            processedAt: new Date(),
            error: error?.substring(0, 500) || 'Unknown error'
          }
        }
      );
    } catch (err) {
      logger.error('Error marking URL as failed', { error: err.message });
    }
  }

  /**
   * Get the count of pending URLs in the queue.
   * @returns {Promise<number>}
   */
  async getPendingCount() {
    try {
      return await this.collection.countDocuments({
        crawlJobId: this.crawlJobId,
        status: 'pending',
      });
    } catch (error) {
      logger.error('Error getting pending count', { error: error.message });
      return 0;
    }
  }

  /**
   * Get full queue stats for this job.
   * @returns {Promise<{pending: number, processing: number, done: number, failed: number}>}
   */
  async getStats() {
    try {
      const pipeline = [
        { $match: { crawlJobId: this.crawlJobId } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ];

      const results = await this.collection.aggregate(pipeline).toArray();

      const stats = { pending: 0, processing: 0, done: 0, failed: 0 };

      for (const result of results) {
        if (result._id in stats) {
          stats[result._id] = result.count;
        }
      }

      return stats;
    } catch (error) {
      logger.error('Error getting queue stats', { error: error.message });
      return { pending: 0, processing: 0, done: 0, failed: 0 };
    }
  }

  /**
   * Rebuild the Redis visited set from MongoDB (for resumability).
   * Called when resuming a job after server restart.
   */
  async rebuildVisitedSet() {
    try {
      const urls = await this.collection
        .find({ crawlJobId: this.crawlJobId }, { projection: { url: 1 } })
        .map(doc => doc.url)
        .toArray();

      if (urls.length > 0) {
        await this.cacheRedis.sadd(this.visitedKey, ...urls);
      }

      logger.info('Rebuild visited set', { jobId: this.crawlJobId.toString(), count: urls.length });
    } catch (error) {
      logger.error('Error rebuilding visited set', { error: error.message });
    }
  }

  /**
   * Reset "processing" items back to "pending" (for resumability).
   * Called on resume to re-process items that were in-flight when server stopped.
   */
  async resetProcessingItems() {
    try {
      const result = await this.collection.updateMany(
        { crawlJobId: this.crawlJobId, status: 'processing' },
        { $set: { status: 'pending' } }
      );

      logger.info('Reset processing items', {
        jobId: this.crawlJobId.toString(),
        count: result.modifiedCount
      });
    } catch (error) {
      logger.error('Error resetting processing items', { error: error.message });
    }
  }

  /**
   * Clean up Redis visited set when job is done or cancelled.
   */
  async cleanup() {
    try {
      await this.cacheRedis.del(this.visitedKey);
    } catch (error) {
      logger.error('Error cleaning up visited set', { error: error.message });
    }
  }
}

module.exports = UrlQueue;
