/**
 * API Routes — mounts all endpoints and the SSE status stream.
 */

const express = require('express');
const indexController = require('./indexController');
const searchController = require('./searchController');
const logsRouter = require('./logsController');
const crawlManager = require('../crawler/crawlManager');
const logger = require('../utils/logger');

const router = express.Router();

// ── Health check ─────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Index (Crawl) endpoints ──────────────────────────
router.post('/index', indexController.startCrawl);
router.get('/index', indexController.listJobs);
router.get('/index/:id', indexController.getJob);
router.post('/index/:id/pause', indexController.pauseJob);
router.post('/index/:id/resume', indexController.resumeJob);
router.delete('/index/:id', indexController.cancelJob);

// ── Search endpoint ──────────────────────────────────
router.get('/search', searchController.searchPages);

// ── Logs endpoint ────────────────────────────────────
router.use('/logs', logsRouter);

// ── SSE Status Stream ────────────────────────────────
// Pushes system status to the dashboard every 2 seconds.
router.get('/status/stream', async (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

  let intervalId = null;

  // Send status updates every 2 seconds
  const sendStatus = async () => {
    try {
      const status = await crawlManager.getSystemStatus();
      res.write(`data: ${JSON.stringify(status)}\n\n`);
    } catch (error) {
      logger.error('Error sending SSE status', { error: error.message });
    }
  };

  // Send initial status
  sendStatus().catch(() => {});

  // Set up interval
  intervalId = setInterval(sendStatus, 2000);

  // Clean up on client disconnect
  req.on('close', () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  });

  // Handle errors
  req.on('error', (err) => {
    logger.error('SSE error', { error: err.message });
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  });
});

module.exports = router;
