/**
 * Crawl Manager — orchestrates the full crawl lifecycle.
 *
 * Responsibilities:
 * - Start/pause/resume/cancel crawl jobs
 * - Run the crawl loop with concurrent fetching
 * - Enforce back pressure (rate limiting + queue depth)
 * - Update job stats in real-time
 * - Resume interrupted jobs on server restart
 */

const { ObjectId } = require('mongodb');
const { getDb } = require('../db/mongo');
const { getCacheRedis } = require('../db/redis');
const { COLLECTIONS } = require('../db/models');
const { fetchPage } = require('./fetcher');
const { extractLinks, extractTitle, extractText } = require('./parser');
const { normalizeUrl, isValidUrl } = require('../utils/urlUtils');
const { indexPage } = require('../search/indexer');
const { RateLimiter, QueueDepthMonitor } = require('./backpressure');
const UrlQueue = require('./urlQueue');
const config = require('../config');
const logger = require('../utils/logger');
const { createJobLogger } = require('./jobLogger');

/** Map of active crawl loops: jobId → { running: boolean, stopRequested: boolean } */
const activeJobs = new Map();

/**
 * Start a new crawl job.
 * Returns immediately — crawl runs in the background.
 *
 * @param {string} origin - Starting URL
 * @param {number} maxDepth - Maximum crawl depth (k)
 * @param {object} [jobConfig] - Optional overrides for back pressure settings
 * @returns {Promise<{jobId: string, status: string}>}
 */
async function startCrawl(origin, maxDepth, jobConfig = {}) {
  try {
    // Validate inputs
    if (!isValidUrl(origin)) {
      throw new Error('Invalid origin URL');
    }

    const depth = parseInt(maxDepth, 10);
    if (isNaN(depth) || depth < 1 || depth > config.maxAllowedDepth) {
      throw new Error(`Depth must be between 1 and ${config.maxAllowedDepth}`);
    }

    const normalizedOrigin = normalizeUrl(origin);
    if (!normalizedOrigin) {
      throw new Error('Failed to normalize origin URL');
    }

    const db = getDb();
    const cacheRedis = getCacheRedis();

    // Create job document
    const jobDoc = {
      origin: normalizedOrigin,
      maxDepth: depth,
      status: 'queued',
      config: {
        maxQueueDepth: jobConfig.maxQueueDepth || config.maxQueueDepth,
        maxRequestsPerSecond: jobConfig.maxRequestsPerSecond || config.maxRequestsPerSecond,
        maxConcurrentFetches: jobConfig.maxConcurrentFetches || config.maxConcurrentFetches
      },
      stats: {
        urlsQueued: 0,
        urlsProcessed: 0,
        urlsFailed: 0,
        pagesIndexed: 0,
        startedAt: new Date(),
        completedAt: null,
        lastActivityAt: new Date()
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection(COLLECTIONS.CRAWL_JOBS).insertOne(jobDoc);
    const jobId = result.insertedId;

    const jobLogger = createJobLogger(jobId);
    await jobLogger.info('Crawl job started', { origin: normalizedOrigin, maxDepth: depth });

    // Create URL queue and enqueue origin
    const urlQueue = new UrlQueue(db, cacheRedis, jobId);
    await urlQueue.enqueue(normalizedOrigin, 0);

    // Update job status to running
    await db.collection(COLLECTIONS.CRAWL_JOBS).updateOne(
      { _id: jobId },
      { $set: { status: 'running', updatedAt: new Date() } }
    );

    // Set up active job tracking
    activeJobs.set(jobId.toString(), { running: true, stopRequested: false });

    // Start crawl loop in background (fire and forget)
    crawlLoop(jobId, urlQueue, depth, jobDoc.config, jobLogger).catch(err => {
      logger.error('Crawl loop error', { jobId: jobId.toString(), error: err.message });
      jobLogger.error('Crawl loop error', { error: err.message });
    });

    logger.info('Crawl job started', { jobId: jobId.toString(), origin: normalizedOrigin, depth });

    return { jobId: jobId.toString(), status: 'running' };

  } catch (error) {
    logger.error('Failed to start crawl', { error: error.message });
    throw error;
  }
}

/**
 * The main crawl loop — runs as a background async task.
 * Fetches pages in batches, respects back pressure, updates stats.
 *
 * @param {ObjectId} jobId
 * @param {UrlQueue} urlQueue
 * @param {number} maxDepth
 * @param {object} jobConfig
 * @param {object} jobLogger
 */
async function crawlLoop(jobId, urlQueue, maxDepth, jobConfig, jobLogger = null) {
  // If no jobLogger provided, create one
  if (!jobLogger) {
    jobLogger = createJobLogger(jobId);
  }
  const db = getDb();
  const jobsCollection = db.collection(COLLECTIONS.CRAWL_JOBS);
  const pagesCollection = db.collection(COLLECTIONS.PAGES);
  const jobIdStr = jobId.toString();

  const rateLimiter = new RateLimiter(jobConfig.maxRequestsPerSecond);
  const queueMonitor = new QueueDepthMonitor(jobConfig.maxQueueDepth);
  const maxConcurrent = jobConfig.maxConcurrentFetches;

  logger.info('Crawl loop started', { jobId: jobIdStr });

  try {
    while (true) {
      // Check if job is still active
      const jobState = activeJobs.get(jobIdStr);
      if (!jobState || jobState.stopRequested) {
        logger.info('Crawl loop stopped (job cancelled)', { jobId: jobIdStr });
        break;
      }

      // Get current job status from DB
      const job = await jobsCollection.findOne({ _id: jobId });
      if (!job) {
        logger.warn('Job disappeared, stopping crawl', { jobId: jobIdStr });
        break;
      }

      if (job.status === 'paused') {
        logger.info('Crawl paused, waiting...', { jobId: jobIdStr });
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      if (job.status === 'cancelled') {
        logger.info('Job cancelled, stopping crawl', { jobId: jobIdStr });
        break;
      }

      // Get queue stats
      const queueStats = await urlQueue.getStats();
      const depthCheck = queueMonitor.check(queueStats.pending + queueStats.processing);

      if (depthCheck.isOverLimit) {
        await jobLogger.warn('Back pressure triggered - queue depth high', {
          queueDepth: depthCheck.currentDepth,
          maxDepth: depthCheck.maxDepth,
          utilizationPercent: depthCheck.utilizationPercent
        });
      }

      // Update job with latest stats
      await jobsCollection.updateOne(
        { _id: jobId },
        {
          $set: {
            'stats.urlsQueued': queueStats.pending + queueStats.processing + queueStats.done,
            'stats.urlsProcessed': queueStats.done,
            'stats.lastActivityAt': new Date()
          }
        }
      );

      // If no pending URLs, mark as completed
      if (queueStats.pending === 0 && queueStats.processing === 0) {
        const job = await jobsCollection.findOne({ _id: jobId });

        await jobsCollection.updateOne(
          { _id: jobId },
          {
            $set: {
              status: 'completed',
              'stats.completedAt': new Date(),
              'stats.urlsProcessed': queueStats.done,
              updatedAt: new Date()
            }
          }
        );

        await jobLogger.info('Crawl completed', {
          urlsProcessed: queueStats.done,
          pagesIndexed: job?.stats?.pagesIndexed || 0,
          durationMs: Date.now() - (job?.stats?.startedAt?.getTime() || Date.now())
        });

        // Clean up visited set
        await urlQueue.cleanup();

        // Remove from active jobs
        activeJobs.delete(jobIdStr);

        logger.info('Crawl completed', { jobId: jobIdStr, urlsProcessed: queueStats.done });
        break;
      }

      // Dequeue batch of URLs
      const batch = await urlQueue.dequeueBatch(maxConcurrent);

      if (batch.length === 0) {
        // No URLs available but queue still has pending items (race condition)
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      // Process batch in parallel
      const results = await Promise.allSettled(
        batch.map(async (item) => {
          try {
            // Check back pressure
            const currentStats = await urlQueue.getStats();
            if (queueMonitor.shouldPause(currentStats.pending)) {
              logger.info('Back pressure: queue depth exceeded, waiting', { jobId: jobIdStr });
              await new Promise(resolve => setTimeout(resolve, 2000));
            }

            // Rate limit
            await rateLimiter.acquire();

            // Fetch page
            const pageData = await fetchPage(item.url);

            await jobLogger.info('Fetched page', { url: item.url, statusCode: pageData.statusCode, depth: item.depth });

            // Parse content
            const links = extractLinks(pageData.body, item.url);
            const title = extractTitle(pageData.body);
            const text = extractText(pageData.body);

            // Store page
            await pagesCollection.insertOne({
              url: item.url,
              crawlJobId: jobId,
              origin: job.origin,
              depth: item.depth,
              title: title,
              statusCode: pageData.statusCode,
              contentType: pageData.headers['content-type'] || '',
              textContent: text.substring(0, 50000), // Limit to 50KB
              links: links,
              wordCount: text.split(/\s+/).length,
              fetchedAt: new Date(),
              indexedAt: null
            });

            // Index page
            await indexPage({
              url: item.url,
              crawlJobId: jobId,
              origin: job.origin,
              depth: item.depth,
              title: title,
              textContent: text
            });

            await jobLogger.info('Indexed page', { url: item.url, wordCount: text.split(/\s+/).length, linksFound: links.length });

            // Enqueue new links if not at max depth
            if (item.depth < maxDepth) {
              for (const link of links) {
                await urlQueue.enqueue(link, item.depth + 1);
              }
            }

            // Mark as done
            await urlQueue.markDone(item._id);

            return { success: true };

          } catch (error) {
            await jobLogger.error('Failed to fetch page', { url: item.url, error: error.message });
            logger.warn('Failed to process URL', { url: item.url, error: error.message });
            await urlQueue.markFailed(item._id, error.message);
            return { success: false, error: error.message };
          }
        })
      );

      // Update failed count
      const failedCount = results.filter(r => r.status === 'rejected' || !r.value.success).length;
      if (failedCount > 0) {
        await jobsCollection.updateOne(
          { _id: jobId },
          { $inc: { 'stats.urlsFailed': failedCount } }
        );
      }

      // Update pages indexed count
      await jobsCollection.updateOne(
        { _id: jobId },
        { $inc: { 'stats.pagesIndexed': batch.length - failedCount } }
      );
    }

  } catch (error) {
    logger.error('Crawl loop fatal error', { jobId: jobIdStr, error: error.message });
    await jobsCollection.updateOne(
      { _id: jobId },
      { $set: { status: 'failed', updatedAt: new Date() } }
    );
  } finally {
    activeJobs.delete(jobIdStr);
  }
}

/**
 * Get status and stats for a specific crawl job.
 * @param {string} jobId
 * @returns {Promise<object|null>}
 */
async function getJobStatus(jobId) {
  try {
    const db = getDb();
    const job = await db.collection(COLLECTIONS.CRAWL_JOBS).findOne({
      _id: new ObjectId(jobId)
    });

    if (!job) return null;

    return {
      ...job,
      _id: job._id.toString()
    };
  } catch (error) {
    logger.error('Error getting job status', { jobId, error: error.message });
    return null;
  }
}

/**
 * List all crawl jobs, ordered by creation time descending.
 * @returns {Promise<object[]>}
 */
async function getAllJobs() {
  try {
    const db = getDb();
    const jobs = await db.collection(COLLECTIONS.CRAWL_JOBS)
      .find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    return jobs.map(job => ({
      ...job,
      _id: job._id.toString()
    }));
  } catch (error) {
    logger.error('Error getting all jobs', { error: error.message });
    return [];
  }
}

/**
 * Pause a running crawl job.
 * The crawl loop checks status on each iteration and will stop processing.
 * @param {string} jobId
 */
async function pauseJob(jobId) {
  try {
    const db = getDb();
    const jobLogger = createJobLogger(new ObjectId(jobId));
    await jobLogger.info('Crawl job paused', { jobId });

    await db.collection(COLLECTIONS.CRAWL_JOBS).updateOne(
      { _id: new ObjectId(jobId) },
      { $set: { status: 'paused', updatedAt: new Date() } }
    );

    logger.info('Job paused', { jobId });
  } catch (error) {
    logger.error('Error pausing job', { jobId, error: error.message });
    throw error;
  }
}

/**
 * Resume a paused crawl job.
 * @param {string} jobId
 */
async function resumeJob(jobId) {
  try {
    const db = getDb();
    const cacheRedis = getCacheRedis();
    const oid = new ObjectId(jobId);

    const job = await db.collection(COLLECTIONS.CRAWL_JOBS).findOne({ _id: oid });
    if (!job) {
      throw new Error('Job not found');
    }

    const jobLogger = createJobLogger(oid);
    await jobLogger.info('Crawl job resumed', { origin: job.origin, maxDepth: job.maxDepth });

    // Create URL queue
    const urlQueue = new UrlQueue(db, cacheRedis, oid);

    // Reset processing items
    await urlQueue.resetProcessingItems();
    await urlQueue.rebuildVisitedSet();

    // Update status and start crawl loop
    await db.collection(COLLECTIONS.CRAWL_JOBS).updateOne(
      { _id: oid },
      {
        $set: {
          status: 'running',
          'stats.startedAt': job.stats.startedAt || new Date(),
          updatedAt: new Date()
        }
      }
    );

    // Set up active job tracking
    activeJobs.set(jobId, { running: true, stopRequested: false });

    // Start crawl loop
    crawlLoop(oid, urlQueue, job.maxDepth, job.config, jobLogger).catch(err => {
      logger.error('Resumed crawl loop error', { jobId, error: err.message });
      jobLogger.error('Crawl loop error', { error: err.message });
    });

    logger.info('Job resumed', { jobId });

  } catch (error) {
    logger.error('Error resuming job', { jobId, error: error.message });
    throw error;
  }
}

/**
 * Cancel a crawl job entirely.
 * @param {string} jobId
 */
async function cancelJob(jobId) {
  try {
    const db = getDb();
    const cacheRedis = getCacheRedis();
    const oid = new ObjectId(jobId);

    const jobLogger = createJobLogger(oid);
    await jobLogger.info('Crawl job cancelled', { jobId });

    // Mark job as cancelled
    await db.collection(COLLECTIONS.CRAWL_JOBS).updateOne(
      { _id: oid },
      { $set: { status: 'cancelled', updatedAt: new Date() } }
    );

    // Signal the crawl loop to stop
    const jobState = activeJobs.get(jobId);
    if (jobState) {
      jobState.stopRequested = true;
    }

    // Clean up visited set
    const urlQueue = new UrlQueue(db, cacheRedis, oid);
    await urlQueue.cleanup();

    logger.info('Job cancelled', { jobId });

  } catch (error) {
    logger.error('Error cancelling job', { jobId, error: error.message });
    throw error;
  }
}

/**
 * Resume any jobs that were "running" when the server last stopped.
 * Called on server startup for resumability.
 */
async function resumeInterruptedJobs() {
  try {
    const db = getDb();
    const cacheRedis = getCacheRedis();

    const interruptedJobs = await db.collection(COLLECTIONS.CRAWL_JOBS)
      .find({ status: 'running' })
      .toArray();

    logger.info('Found interrupted jobs to resume', { count: interruptedJobs.length });

    for (const job of interruptedJobs) {
      const jobId = job._id.toString();

      const jobLogger = createJobLogger(job._id);
      await jobLogger.info('Crawl job resumed after restart', { origin: job.origin, maxDepth: job.maxDepth });

      // Create URL queue
      const urlQueue = new UrlQueue(db, cacheRedis, job._id);

      // Reset processing items and rebuild visited set
      await urlQueue.resetProcessingItems();
      await urlQueue.rebuildVisitedSet();

      // Set up active job tracking
      activeJobs.set(jobId, { running: true, stopRequested: false });

      // Start crawl loop
      crawlLoop(job._id, urlQueue, job.maxDepth, job.config, jobLogger).catch(err => {
        logger.error('Resumed crawl loop error', { jobId, error: err.message });
        jobLogger.error('Crawl loop error', { error: err.message });
      });

      logger.info('Resumed interrupted job', { jobId, origin: job.origin });
    }

  } catch (error) {
    logger.error('Error resuming interrupted jobs', { error: error.message });
  }
}

/**
 * Get aggregated system status for the SSE stream.
 * @returns {Promise<object>}
 */
async function getSystemStatus() {
  try {
    const db = getDb();

    // Get all jobs
    const jobs = await db.collection(COLLECTIONS.CRAWL_JOBS)
      .find({})
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    const jobsFormatted = jobs.map(job => ({
      ...job,
      _id: job._id.toString()
    }));

    // Calculate system stats
    const statsAgg = await db.collection(COLLECTIONS.CRAWL_JOBS).aggregate([
      {
        $group: {
          _id: null,
          activeJobs: { $sum: { $cond: [{ $eq: ['$status', 'running'] }, 1, 0] } },
          totalJobs: { $sum: 1 }
        }
      }
    ]).toArray();

    const queueStats = await db.collection(COLLECTIONS.CRAWL_QUEUE).aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    let totalQueued = 0;
    let totalProcessed = 0;
    for (const stat of queueStats) {
      if (stat._id === 'pending') totalQueued += stat.count;
      if (stat._id === 'processing') totalQueued += stat.count;
      if (stat._id === 'done') totalProcessed += stat.count;
    }

    return {
      jobs: jobsFormatted,
      system: {
        totalUrlsQueued: totalQueued,
        totalUrlsProcessed: totalProcessed,
        activeJobs: statsAgg[0]?.activeJobs || 0,
        totalJobs: statsAgg[0]?.totalJobs || 0,
        timestamp: new Date().toISOString()
      }
    };

  } catch (error) {
    logger.error('Error getting system status', { error: error.message });
    return {
      jobs: [],
      system: {
        totalUrlsQueued: 0,
        totalUrlsProcessed: 0,
        activeJobs: 0,
        totalJobs: 0,
        timestamp: new Date().toISOString()
      }
    };
  }
}

module.exports = {
  startCrawl,
  getJobStatus,
  getAllJobs,
  pauseJob,
  resumeJob,
  cancelJob,
  resumeInterruptedJobs,
  getSystemStatus,
};
