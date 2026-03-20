/**
 * Index Controller — handles crawl job CRUD operations.
 *
 * Endpoints:
 *   POST   /api/index          — Start a new crawl
 *   GET    /api/index          — List all jobs
 *   GET    /api/index/:id      — Get job details
 *   POST   /api/index/:id/pause  — Pause a job
 *   POST   /api/index/:id/resume — Resume a job
 *   DELETE /api/index/:id      — Cancel a job
 */

const { ObjectId } = require('mongodb');
const crawlManager = require('../crawler/crawlManager');
const { isValidUrl } = require('../utils/urlUtils');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * POST /api/index
 * Start a new crawl job.
 * Body: { origin: string, depth: number, config?: { maxQueueDepth?, maxRequestsPerSecond?, maxConcurrentFetches? } }
 */
async function startCrawl(req, res) {
  try {
    const { origin, depth, config: jobConfig } = req.body;

    // Validate origin
    if (!origin || typeof origin !== 'string') {
      return res.status(400).json({ error: 'Invalid origin URL' });
    }

    if (!isValidUrl(origin)) {
      return res.status(400).json({ error: 'Origin must be a valid HTTP/HTTPS URL' });
    }

    // Validate depth
    const parsedDepth = parseInt(depth, 10);
    if (isNaN(parsedDepth) || parsedDepth < 1 || parsedDepth > config.maxAllowedDepth) {
      return res.status(400).json({
        error: `Depth must be between 1 and ${config.maxAllowedDepth}`
      });
    }

    // Validate job config if provided
    const validConfig = {};
    if (jobConfig) {
      if (jobConfig.maxQueueDepth !== undefined) {
        const mqd = parseInt(jobConfig.maxQueueDepth, 10);
        if (isNaN(mqd) || mqd < 100) {
          return res.status(400).json({ error: 'maxQueueDepth must be at least 100' });
        }
        validConfig.maxQueueDepth = mqd;
      }

      if (jobConfig.maxRequestsPerSecond !== undefined) {
        const mrps = parseInt(jobConfig.maxRequestsPerSecond, 10);
        if (isNaN(mrps) || mrps < 1 || mrps > 100) {
          return res.status(400).json({ error: 'maxRequestsPerSecond must be between 1 and 100' });
        }
        validConfig.maxRequestsPerSecond = mrps;
      }

      if (jobConfig.maxConcurrentFetches !== undefined) {
        const mcf = parseInt(jobConfig.maxConcurrentFetches, 10);
        if (isNaN(mcf) || mcf < 1 || mcf > 50) {
          return res.status(400).json({ error: 'maxConcurrentFetches must be between 1 and 50' });
        }
        validConfig.maxConcurrentFetches = mcf;
      }
    }

    const result = await crawlManager.startCrawl(origin, parsedDepth, validConfig);

    res.status(201).json({
      jobId: result.jobId,
      status: result.status,
      origin,
      depth: parsedDepth
    });

  } catch (error) {
    logger.error('Error starting crawl', { error: error.message });
    res.status(500).json({ error: 'Failed to start crawl job' });
  }
}

/**
 * GET /api/index
 * List all crawl jobs.
 */
async function listJobs(req, res) {
  try {
    const jobs = await crawlManager.getAllJobs();
    res.json(jobs);
  } catch (error) {
    logger.error('Error listing jobs', { error: error.message });
    res.status(500).json({ error: 'Failed to list jobs' });
  }
}

/**
 * GET /api/index/:id
 * Get details for a specific crawl job.
 */
async function getJob(req, res) {
  try {
    const { id } = req.params;

    // Validate ObjectId format
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const job = await crawlManager.getJobStatus(id);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);

  } catch (error) {
    logger.error('Error getting job', { error: error.message });
    res.status(500).json({ error: 'Failed to get job details' });
  }
}

/**
 * POST /api/index/:id/pause
 * Pause a running crawl job.
 */
async function pauseJob(req, res) {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const job = await crawlManager.getJobStatus(id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'running') {
      return res.status(400).json({ error: 'Job is not running' });
    }

    await crawlManager.pauseJob(id);
    res.json({ message: 'Job paused', jobId: id });

  } catch (error) {
    logger.error('Error pausing job', { error: error.message });
    res.status(500).json({ error: 'Failed to pause job' });
  }
}

/**
 * POST /api/index/:id/resume
 * Resume a paused crawl job.
 */
async function resumeJob(req, res) {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const job = await crawlManager.getJobStatus(id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'paused') {
      return res.status(400).json({ error: 'Job is not paused' });
    }

    await crawlManager.resumeJob(id);
    res.json({ message: 'Job resumed', jobId: id });

  } catch (error) {
    logger.error('Error resuming job', { error: error.message });
    res.status(500).json({ error: 'Failed to resume job' });
  }
}

/**
 * DELETE /api/index/:id
 * Cancel a crawl job.
 */
async function cancelJob(req, res) {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const job = await crawlManager.getJobStatus(id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    await crawlManager.cancelJob(id);
    res.json({ message: 'Job cancelled', jobId: id });

  } catch (error) {
    logger.error('Error cancelling job', { error: error.message });
    res.status(500).json({ error: 'Failed to cancel job' });
  }
}

module.exports = { startCrawl, listJobs, getJob, pauseJob, resumeJob, cancelJob };
