# Expandable Job Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add expandable, real-time logs to each job card showing crawl progress, errors, and events.

**Architecture:**
- Backend: New `crawl_logs` MongoDB collection stores log entries per job. Logger utility enhanced to write structured logs. API endpoint fetches logs with pagination. SSE streams new log entries.
- Frontend: Expandable log panel within job cards using HTML details/summary. Auto-scroll toggle. Color-coded log levels (info, warn, error).

**Tech Stack:** MongoDB (logs storage), Express.js (API endpoints), Server-Sent Events (real-time updates), Vanilla JS/CSS (UI), Tailwind collapse pattern (details/summary).

---

## File Structure

```
src/
├── db/
│   ├── models.js                 # ADD: CRAWL_LOGS collection + indexes
├── utils/
│   ├── logger.js                 # MODIFY: add jobLog() function for job-scoped logging
├── api/
│   ├── logsController.js         # CREATE: GET /api/logs/:jobId endpoint
│   └── routes.js                 # MODIFY: mount logs routes
├── crawler/
│   ├── crawlManager.js           # MODIFY: add logging calls at key events
│   └── jobLogger.js              # CREATE: convenience wrapper for job logging
public/
├── app.js                        # MODIFY: add log fetching, toggle, render
└── style.css                     # MODIFY: add log viewer styles
```

---

## Task 1: Backend - Database Layer

**Files:**
- Modify: `src/db/models.js`
- Test: `tests/db/models.test.js` (CREATE)

- [ ] **Step 1: Write test for CRAWL_LOGS collection constant**

```javascript
// tests/db/models.test.js
const assert = require('node:assert/strict');
const { COLLECTIONS } = require('../../src/db/models');

describe('COLLECTIONS', () => {
  it('should export CRAWL_LOGS constant', () => {
    assert.strictEqual(COLLECTIONS.CRAWL_LOGS, 'crawl_logs');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/db/models.test.js`
Expected: FAIL with "CRAWL_LOGS is not defined"

- [ ] **Step 3: Add CRAWL_LOGS constant to models.js**

```javascript
// src/db/models.js - Add to COLLECTIONS object:
const COLLECTIONS = {
  CRAWL_JOBS: 'crawl_jobs',
  PAGES: 'pages',
  WORD_INDEX: 'word_index',
  CRAWL_QUEUE: 'crawl_queue',
  CRAWL_LOGS: 'crawl_logs',  // ADD THIS LINE
};
```

- [ ] **Step 4: Add indexes for crawl_logs collection in ensureIndexes()**

```javascript
// src/db/models.js - Inside ensureIndexes() function, after crawl_queue indexes:

// Crawl logs collection
const crawlLogs = db.collection(COLLECTIONS.CRAWL_LOGS);
await crawlLogs.createIndex({ crawlJobId: 1, timestamp: -1 });
await crawlLogs.createIndex({ crawlJobId: 1, level: 1, timestamp: -1 });
await crawlLogs.createIndex({ timestamp: 1 }, { expireAfterSeconds: 604800 }); // 7 day TTL
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/db/models.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/db/models.js tests/db/models.test.js
git commit -m "feat(db): add CRAWL_LOGS collection with indexes"
```

---

## Task 2: Backend - Job Logger Utility

**Files:**
- Create: `src/crawler/jobLogger.js`
- Test: `tests/crawler/jobLogger.test.js` (CREATE)

- [ ] **Step 1: Write failing test for jobLogger**

```javascript
// tests/crawler/jobLogger.test.js
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { createJobLogger } = require('../../src/crawler/jobLogger');

describe('createJobLogger', () => {
  it('should return a logger with info, warn, error methods', () => {
    const jobId = new ObjectId();
    const logger = createJobLogger(jobId);
    assert.strictEqual(typeof logger.info, 'function');
    assert.strictEqual(typeof logger.warn, 'function');
    assert.strictEqual(typeof logger.error, 'function');
  });

  it('should write log entry to database', async () => {
    const { getDb } = require('../../src/db/mongo');
    await getDb(); // connect
    const { getDb } = require('../../src/db/mongo');
    const db = getDb();
    const { COLLECTIONS } = require('../../src/db/models');

    const jobId = new ObjectId();
    const logger = createJobLogger(jobId);
    await logger.info('Test message', { url: 'http://test.com' });

    const logs = await db.collection(COLLECTIONS.CRAWL_LOGS)
      .find({ crawlJobId: jobId })
      .toArray();
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].message, 'Test message');
    assert.strictEqual(logs[0].level, 'info');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/crawler/jobLogger.test.js`
Expected: FAIL with module not found

- [ ] **Step 3: Implement jobLogger.js**

```javascript
// src/crawler/jobLogger.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/crawler/jobLogger.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/crawler/jobLogger.js tests/crawler/jobLogger.test.js
git commit -m "feat(crawler): add job-scoped logger utility"
```

---

## Task 3: Backend - Logs API Endpoint

**Files:**
- Create: `src/api/logsController.js`
- Modify: `src/api/routes.js`
- Test: `tests/api/logsController.test.js` (CREATE)

- [ ] **Step 1: Write failing test for logs endpoint**

```javascript
// tests/api/logsController.test.js
const assert = require('node:assert/strict');
const request = require('supertest');
const express = require('express');
const { ObjectId } = require('mongodb');

// Mock dependencies
jest.mock('../../src/db/mongo');
jest.mock('../../src/crawler/jobLogger');

const app = express();
app.use(express.json());
app.use('/api/logs', require('../../src/api/logsController'));

describe('GET /api/logs/:jobId', () => {
  it('should return logs for a job', async () => {
    const jobId = new ObjectId();
    const response = await request(app)
      .get(`/api/logs/${jobId.toString()}`)
      .expect(200);

    assert.ok(Array.isArray(response.body.logs));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/api/logsController.test.js`
Expected: FAIL with module not found

- [ ] **Step 3: Implement logsController.js**

```javascript
// src/api/logsController.js
const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db/mongo');
const { COLLECTIONS } = require('../db/models');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/logs/:jobId
 * Fetch logs for a specific crawl job.
 * Query params: limit (default 100), offset (default 0), level (optional filter)
 */
async function getJobLogs(req, res) {
  try {
    const { jobId } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;
    const level = req.query.level; // 'info', 'warn', 'error'

    if (!ObjectId.isValid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }

    const db = getDb();
    const filter = { crawlJobId: new ObjectId(jobId) };

    if (level && ['info', 'warn', 'error'].includes(level)) {
      filter.level = level;
    }

    const logs = await db.collection(COLLECTIONS.CRAWL_LOGS)
      .find(filter)
      .sort({ timestamp: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    const total = await db.collection(COLLECTIONS.CRAWL_LOGS).countDocuments(filter);

    res.json({
      logs,
      total,
      offset,
      limit
    });

  } catch (error) {
    logger.error('Error fetching logs', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
}

// Mount routes
router.get('/:jobId', getJobLogs);

module.exports = router;
```

- [ ] **Step 4: Mount logs routes in routes.js**

```javascript
// src/api/routes.js - Add after search endpoint:
const logsRouter = require('./logsController');
app.use('/logs', logsRouter);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/api/logsController.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/api/logsController.js src/api/routes.js tests/api/logsController.test.js
git commit -m "feat(api): add logs endpoint for job activity"
```

---

## Task 4: Backend - Integrate Logging in Crawl Manager

**Files:**
- Modify: `src/crawler/crawlManager.js`

- [ ] **Step 1: Add jobLogger import and initialization**

```javascript
// src/crawler/crawlManager.js - Add to imports:
const { createJobLogger } = require('./jobLogger');
```

- [ ] **Step 2: Initialize jobLogger in startCrawl()**

```javascript
// src/crawler/crawlManager.js - Inside startCrawl(), after creating jobId:
const jobLogger = createJobLogger(jobId);
await jobLogger.info('Crawl job started', { origin: normalizedOrigin, maxDepth: depth });

// Pass jobLogger to crawlLoop
crawlLoop(jobId, urlQueue, depth, jobDoc.config, jobLogger).catch(err => {
  logger.error('Crawl loop error', { jobId: jobId.toString(), error: err.message });
  jobLogger.error('Crawl loop error', { error: err.message });
});
```

- [ ] **Step 3: Update crawlLoop signature to accept jobLogger**

```javascript
// src/crawler/crawlManager.js - Update crawlLoop function signature:
async function crawlLoop(jobId, urlQueue, maxDepth, jobConfig, jobLogger = null) {
  // If no jobLogger provided, create one
  if (!jobLogger) {
    jobLogger = createJobLogger(jobId);
  }
```

- [ ] **Step 4: Add logging at key crawl events**

```javascript
// src/crawler/crawlManager.js - Add logs in crawlLoop:

// After fetching a page successfully:
await jobLogger.info('Fetched page', { url: item.url, statusCode: pageData.statusCode, depth: item.depth });

// On page fetch error:
await jobLogger.error('Failed to fetch page', { url: item.url, error: error.message });

// After indexing a page:
await jobLogger.info('Indexed page', { url: item.url, wordCount: text.split(/\s+/).length, linksFound: links.length });

// When job completes:
await jobLogger.info('Crawl completed', { urlsProcessed: queueStats.done, totalLogs: total });

// When back pressure triggers:
await jobLogger.warn('Back pressure triggered - queue depth high', { queueDepth: currentStats.pending, maxDepth: jobConfig.maxQueueDepth });

// When pausing:
await jobLogger.info('Job paused');

// When resuming:
await jobLogger.info('Job resumed');
```

- [ ] **Step 5: Commit**

```bash
git add src/crawler/crawlManager.js
git commit -m "feat(crawler): integrate job logging throughout crawl lifecycle"
```

---

## Task 5: Frontend - Log Viewer UI Component

**Files:**
- Modify: `public/app.js`
- Modify: `public/style.css`

- [ ] **Step 1: Add log viewer state and functions to app.js**

```javascript
// public/app.js - Add to state section:
const jobLogs = new Map(); // jobId -> { logs: [], expanded: false, autoScroll: true }
const logPollingInterval = 2000; // Poll every 2 seconds when expanded
const logPollers = new Map(); // jobId -> interval ID

// Add function to fetch logs for a job:
async function fetchJobLogs(jobId) {
  try {
    const response = await fetch(`/api/logs/${jobId}?limit=100`);
    const data = await response.json();

    if (!jobLogs.has(jobId)) {
      jobLogs.set(jobId, { logs: [], expanded: false, autoScroll: true });
    }

    const jobLogState = jobLogs.get(jobId);
    // Prepend new logs (since we get newest first)
    const existingIds = new Set(jobLogState.logs.map(l => l._id));
    const newLogs = data.logs.filter(l => !existingIds.has(l._id));
    jobLogState.logs = [...newLogs.reverse(), ...jobLogState.logs];

    return data.logs;
  } catch (error) {
    console.error('Error fetching logs:', error);
    return [];
  }
}

// Add function to toggle log expansion:
function toggleLogs(jobId) {
  if (!jobLogs.has(jobId)) {
    jobLogs.set(jobId, { logs: [], expanded: false, autoScroll: true });
  }

  const state = jobLogs.get(jobId);
  state.expanded = !state.expanded;

  if (state.expanded) {
    // Start polling
    fetchJobLogs(jobId).then(() => renderJobs(currentJobs));
    startLogPoller(jobId);
  } else {
    // Stop polling
    stopLogPoller(jobId);
  }

  renderJobs(currentJobs);
}

// Add poller management functions:
function startLogPoller(jobId) {
  stopLogPoller(jobId); // Clear any existing

  const intervalId = setInterval(async () => {
    const hasNewLogs = await fetchJobLogs(jobId);
    if (hasNewLogs.length > 0) {
      renderJobs(currentJobs);
    }
  }, logPollingInterval);

  logPollers.set(jobId, intervalId);
}

function stopLogPoller(jobId) {
  if (logPollers.has(jobId)) {
    clearInterval(logPollers.get(jobId));
    logPollers.delete(jobId);
  }
}

// Add function to toggle auto-scroll:
function toggleAutoScroll(jobId) {
  if (!jobLogs.has(jobId)) {
    jobLogs.set(jobId, { logs: [], expanded: false, autoScroll: true });
  }

  const state = jobLogs.get(jobId);
  state.autoScroll = !state.autoScroll;
  renderJobs(currentJobs);
}
```

- [ ] **Step 2: Add click handler for log toggle**

```javascript
// public/app.js - Add to document click handler (inside existing listener):
const logToggle = e.target.closest('[data-log-toggle]');
if (logToggle) {
  const jobId = logToggle.dataset.jobId;
  toggleLogs(jobId);
  return;
}

const autoScrollToggle = e.target.closest('[data-autoscroll-toggle]');
if (autoScrollToggle) {
  const jobId = autoScrollToggle.dataset.jobId;
  toggleAutoScroll(jobId);
  return;
}
```

- [ ] **Step 3: Update buildJobCard() to include log viewer**

```javascript
// public/app.js - Replace existing buildJobCard function with:
function buildJobCard(job) {
  const statusClass = job.status || 'queued';
  const stats = job.stats || {};
  const config = job.config || {};
  const jobId = job._id;

  const urlsProcessed = stats.urlsProcessed || 0;
  const urlsQueued = stats.urlsQueued || 0;
  const urlsFailed = stats.urlsFailed || 0;
  const pagesIndexed = stats.pagesIndexed || 0;

  const total = urlsProcessed + urlsQueued;
  const progress = total > 0 ? (urlsProcessed / total) * 100 : 0;
  const isRunning = job.status === 'running';
  const isPaused = job.status === 'paused';
  const isCompleted = job.status === 'completed';

  const queueUtilization = config.maxQueueDepth ? (urlsQueued / config.maxQueueDepth) * 100 : 0;
  const showBackPressureWarning = isRunning && queueUtilization > 80;

  let actionButtons = '';
  if (isRunning) {
    actionButtons = `<button type="button" data-action="pause" data-id="${jobId}" class="secondary">Pause</button>`;
  } else if (isPaused) {
    actionButtons = `<button type="button" data-action="resume" data-id="${jobId}">Resume</button>`;
  }

  if (!isCompleted) {
    actionButtons += `<button type="button" data-action="cancel" data-id="${jobId}" class="danger">Cancel</button>`;
  }

  // Get log state for this job
  const logState = jobLogs.get(jobId) || { logs: [], expanded: false, autoScroll: true };
  const showLogs = logState.expanded;

  // Count logs by level
  const errorCount = logState.logs.filter(l => l.level === 'error').length;
  const warnCount = logState.logs.filter(l => l.level === 'warn').length;
  const infoCount = logState.logs.filter(l => l.level === 'info').length;

  return `
    <div class="job-card" data-job-id="${jobId}">
      <div class="job-header">
        <span class="job-origin">${escapeHtml(job.origin)}</span>
        <span class="job-status ${statusClass}">${job.status || 'queued'}</span>
      </div>

      <div class="progress-bar">
        <div class="progress-fill ${showBackPressureWarning ? 'throttled' : ''}" style="width: ${progress}%"></div>
      </div>

      ${showBackPressureWarning ? `<div class="backpressure-warning">⚠️ Queue depth: ${formatNumber(urlsQueued)} / ${formatNumber(config.maxQueueDepth)}</div>` : ''}

      <div class="job-stats">
        <div class="stat">
          <div class="stat-value">${formatNumber(urlsProcessed)}</div>
          <div class="stat">Processed</div>
        </div>
        <div class="stat">
          <div class="stat-value">${formatNumber(urlsQueued)}</div>
          <div class="stat">Queued</div>
        </div>
        <div class="stat">
          <div class="stat-value">${formatNumber(urlsFailed)}</div>
          <div class="stat">Failed</div>
        </div>
        <div class="stat">
          <div class="stat-value">${formatNumber(pagesIndexed)}</div>
          <div class="stat">Indexed</div>
        </div>
        <div class="stat">
          <div class="stat-value">${job.maxDepth}</div>
          <div class="stat">Depth</div>
        </div>
      </div>

      <div class="job-actions">
        ${actionButtons}
        <button type="button" data-log-toggle="${jobId}" class="secondary" title="Toggle logs">
          📋 Logs ${errorCount > 0 ? `(${errorCount} errors)` : ''}
        </button>
      </div>

      ${showLogs ? `
        <div class="job-logs" data-job-logs="${jobId}">
          <div class="logs-header">
            <span>Activity Log</span>
            <button type="button" data-autoscroll-toggle="${jobId}" class="log-toggle-btn" title="Toggle auto-scroll">
              ${logState.autoScroll ? '🔄 Auto-scroll: On' : '⏸️ Auto-scroll: Off'}
            </button>
          </div>
          <div class="logs-container" ${logState.autoScroll ? 'data-auto-scroll="true"' : ''}>
            ${logState.logs.length === 0 ? '<div class="log-entry log-info">Waiting for logs...</div>' : ''}
            ${logState.logs.map(log => buildLogEntry(log)).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function buildLogEntry(log) {
  const levelClass = `log-${log.level || 'info'}`;
  const timestamp = new Date(log.timestamp).toLocaleTimeString();
  const metaStr = Object.keys(log.meta || {}).length > 0
    ? `<span class="log-meta">${JSON.stringify(log.meta)}</span>`
    : '';

  return `
    <div class="log-entry ${levelClass}">
      <span class="log-time">${timestamp}</span>
      <span class="log-message">${escapeHtml(log.message)}</span>
      ${metaStr}
    </div>
  `;
}
```

- [ ] **Step 4: Add CSS styles for log viewer**

```css
/* public/style.css - Add at the end: */

/* ── Job Logs Viewer ──────────────────────────────── */
.job-logs {
  margin-top: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.75rem;
  background: var(--surface-hover);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
}

.log-toggle-btn {
  font-size: 0.65rem;
  padding: 0.2rem 0.5rem;
}

.logs-container {
  max-height: 300px;
  overflow-y: auto;
  padding: 0.5rem;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 0.7rem;
  background: var(--bg);
}

.log-entry {
  padding: 0.25rem 0.5rem;
  margin-bottom: 0.125rem;
  border-radius: 4px;
  line-height: 1.4;
}

.log-time {
  color: var(--text-muted);
  margin-right: 0.5rem;
}

.log-message {
  color: var(--text);
}

.log-meta {
  color: var(--text-muted);
  margin-left: 0.5rem;
  font-size: 0.9em;
}

.log-info {
  background: rgba(59, 130, 246, 0.1);
  border-left: 2px solid var(--info);
}

.log-warn {
  background: rgba(245, 158, 11, 0.1);
  border-left: 2px solid var(--warning);
}

.log-error {
  background: rgba(239, 68, 68, 0.1);
  border-left: 2px solid var(--danger);
}

/* Auto-scroll indicator */
.logs-container[data-auto-scroll="true"] {
  scroll-behavior: smooth;
}
```

- [ ] **Step 5: Add auto-scroll after render**

```javascript
// public/app.js - Add to renderJobs() function, after setting innerHTML:
if (jobsContainer.innerHTML !== '') {
  // Auto-scroll expanded log containers
  document.querySelectorAll('.logs-container[data-auto-scroll="true"]').forEach(container => {
    container.scrollTop = container.scrollHeight;
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat(ui): add expandable log viewer to job cards"
```

---

## Task 6: Cleanup & Polish

**Files:**
- Modify: `src/crawler/crawlManager.js`

- [ ] **Step 1: Stop log polling when job completes**

```javascript
// src/crawler/crawlManager.js - In crawlLoop(), when job completes:
if (queueStats.pending === 0 && queueStats.processing === 0) {
  await jobLogger.info('Crawl completed successfully', {
    urlsProcessed: queueStats.done,
    pagesIndexed: stats.pagesIndexed,
    duration: Date.now() - job.stats.startedAt.getTime()
  });

  // ... rest of completion code ...

  // Note: Frontend will stop polling when status changes to 'completed'
}
```

- [ ] **Step 2: Add log cleanup for old jobs**

```javascript
// src/db/models.js - In ensureIndexes(), logs already have 7-day TTL via expireAfterSeconds
```

- [ ] **Step 3: Test end-to-end**

Run: `docker compose up -d`
Then:
1. Start a crawl job
2. Click "Logs" button on the job card
3. Verify logs appear and update in real-time
4. Verify auto-scroll works
5. Verify color-coded log levels
6. Pause/resume and verify log continuity

- [ ] **Step 4: Commit**

```bash
git add src/crawler/crawlManager.js
git commit -m "chore(crawler): add completion logging and cleanup"
```

---

## Testing Checklist

After implementation, verify:

- [ ] Logs appear in real-time as crawl progresses
- [ ] Error logs are highlighted in red
- [ ] Warning logs are highlighted in yellow
- [ ] Info logs are highlighted in blue
- [ ] Log viewer collapses/expands smoothly
- [ ] Auto-scroll can be toggled on/off
- [ ] Multiple jobs can have logs open simultaneously
- [ ] Polling stops when job completes
- [ ] Polling stops when logs are collapsed
- [ ] Log viewer shows "Waiting for logs..." when empty
- [ ] Old logs are automatically cleaned up after 7 days

---

## Rollback Plan

If issues arise:
1. Revert commits in reverse order
2. Drop `crawl_logs` collection: `db.crawl_logs.drop()`
3. Remove `CRAWL_LOGS` from COLLECTIONS constant
4. Remove log viewer UI from job cards
