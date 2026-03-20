/**
 * Ninova Crawler — Main Server Entry Point
 * 
 * Initializes Express, connects to databases, mounts API routes,
 * serves the frontend, and handles graceful shutdown.
 */

const express = require('express');
const path = require('path');
const config = require('./config');
const mongo = require('./db/mongo');
const redis = require('./db/redis');
const apiRoutes = require('./api/routes');
const crawlManager = require('./crawler/crawlManager');
const logger = require('./utils/logger');

const app = express();

// ── Middleware ────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// CORS headers for development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Static files (Dashboard UI) ─────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── API Routes ───────────────────────────────────────
app.use('/api', apiRoutes);

// ── Catch-all: serve dashboard for non-API routes ───
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Error handler ────────────────────────────────────
app.use((err, req, res, _next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// ── Startup ──────────────────────────────────────────
async function start() {
  try {
    logger.info('Starting Ninova Crawler...');

    // Connect to databases
    await mongo.connect();
    logger.info('MongoDB connected');

    await redis.connect();
    logger.info('Redis connected (queue + cache)');

    // Resume any interrupted crawl jobs
    await crawlManager.resumeInterruptedJobs();

    // Start HTTP server
    app.listen(config.port, () => {
      logger.info(`Ninova Crawler running on http://localhost:${config.port}`);
    });
  } catch (err) {
    logger.error('Failed to start server', { error: err.message });
    process.exit(1);
  }
}

// ── Graceful Shutdown ────────────────────────────────
async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  try {
    await redis.closeAll();
    await mongo.close();
    logger.info('All connections closed');
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', { error: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start the server
start();
