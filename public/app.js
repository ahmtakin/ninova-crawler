/**
 * Ninova Dashboard — Frontend JavaScript
 *
 * Handles:
 * - SSE connection for live system status
 * - Start crawl form submission
 * - Search form submission
 * - Live job status rendering
 * - Pause/resume/cancel actions
 */

// ── State ────────────────────────────────────────────
let eventSource = null;
let currentJobs = [];

// ── DOM References ───────────────────────────────────
const crawlForm = document.getElementById('crawl-form');
const crawlFeedback = document.getElementById('crawl-feedback');
const jobsContainer = document.getElementById('jobs-container');
const activeCount = document.getElementById('active-count');
const searchForm = document.getElementById('search-form');
const searchResults = document.getElementById('search-results');
const searchInfo = document.getElementById('search-info');
const connectionDot = document.getElementById('connection-dot');
const connectionText = document.getElementById('connection-text');

// ── SSE Connection ───────────────────────────────────

function connectSSE() {
  // Close existing connection if any
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/status/stream');

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);

      if (data.type === 'connected') {
        setConnectionStatus(true);
        return;
      }

      if (data.jobs) {
        currentJobs = data.jobs;
        renderJobs(data.jobs);
      }

      if (data.system) {
        updateSystemStatus(data.system);
      }
    } catch (err) {
      console.error('Error parsing SSE data:', err);
    }
  };

  eventSource.onopen = () => {
    setConnectionStatus(true);
  };

  eventSource.onerror = () => {
    setConnectionStatus(false);
    // Attempt reconnect after 5 seconds
    setTimeout(() => {
      if (eventSource.readyState === EventSource.CLOSED) {
        connectSSE();
      }
    }, 5000);
  };
}

function setConnectionStatus(connected) {
  if (connected) {
    connectionDot.classList.remove('disconnected');
    connectionDot.classList.add('connected');
    connectionText.textContent = 'Connected';
  } else {
    connectionDot.classList.remove('connected');
    connectionDot.classList.add('disconnected');
    connectionText.textContent = 'Disconnected - Reconnecting...';
  }
}

function updateSystemStatus(system) {
  if (system.activeJobs !== undefined) {
    activeCount.textContent = system.activeJobs;
  }
}

// ── Render Jobs ──────────────────────────────────────

function renderJobs(jobs) {
  if (!jobs || jobs.length === 0) {
    jobsContainer.innerHTML = '<p class="empty-state">No crawl jobs yet. Start one above.</p>';
    activeCount.textContent = '0';
    return;
  }

  let html = '';
  for (const job of jobs) {
    html += buildJobCard(job);
  }

  jobsContainer.innerHTML = html;
}

// ── Build a single job card HTML ─────────────────────

function buildJobCard(job) {
  const statusClass = job.status || 'queued';
  const stats = job.stats || {};
  const config = job.config || {};

  const urlsProcessed = stats.urlsProcessed || 0;
  const urlsQueued = stats.urlsQueued || 0;
  const urlsFailed = stats.urlsFailed || 0;
  const pagesIndexed = stats.pagesIndexed || 0;

  const total = urlsProcessed + urlsQueued;
  const progress = total > 0 ? (urlsProcessed / total) * 100 : 0;
  const isRunning = job.status === 'running';
  const isPaused = job.status === 'paused';
  const isCompleted = job.status === 'completed';

  // Back pressure calculation
  const queueUtilization = config.maxQueueDepth ? (urlsQueued / config.maxQueueDepth) * 100 : 0;
  const showBackPressureWarning = isRunning && queueUtilization > 80;

  let actionButtons = '';
  if (isRunning) {
    actionButtons = `<button type="button" data-action="pause" data-id="${job._id}" class="secondary">Pause</button>`;
  } else if (isPaused) {
    actionButtons = `<button type="button" data-action="resume" data-id="${job._id}">Resume</button>`;
  }

  if (!isCompleted) {
    actionButtons += `<button type="button" data-action="cancel" data-id="${job._id}" class="danger">Cancel</button>`;
  }

  return `
    <div class="job-card">
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
      </div>
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Start Crawl ──────────────────────────────────────

crawlForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const origin = document.getElementById('origin-url').value.trim();
  const depth = document.getElementById('crawl-depth').value;
  const maxRps = document.getElementById('max-rps').value;
  const maxConcurrent = document.getElementById('max-concurrent').value;
  const maxQueue = document.getElementById('max-queue').value;

  const body = {
    origin,
    depth: parseInt(depth, 10)
  };

  // Add optional config
  const config = {};
  if (maxRps) config.maxRequestsPerSecond = parseInt(maxRps, 10);
  if (maxConcurrent) config.maxConcurrentFetches = parseInt(maxConcurrent, 10);
  if (maxQueue) config.maxQueueDepth = parseInt(maxQueue, 10);

  if (Object.keys(config).length > 0) {
    body.config = config;
  }

  try {
    const response = await fetch('/api/index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (response.ok) {
      showFeedback(crawlFeedback, `Crawl started! Job ID: ${data.jobId}`, 'success');
      crawlForm.reset();
    } else {
      showFeedback(crawlFeedback, data.error || 'Failed to start crawl', 'error');
    }
  } catch (error) {
    showFeedback(crawlFeedback, 'Network error: Failed to start crawl', 'error');
  }
});

// ── Search ───────────────────────────────────────────

searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const query = document.getElementById('search-query').value.trim();
  if (!query) return;

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await response.json();

    if (response.ok) {
      renderSearchResults(data);
    } else {
      showFeedback(searchInfo, data.error || 'Search failed', 'error');
    }
  } catch (error) {
    showFeedback(searchInfo, 'Network error: Search failed', 'error');
  }
});

function renderSearchResults(data) {
  searchInfo.classList.remove('hidden');
  searchInfo.className = 'search-info';

  if (!data.results || data.results.length === 0) {
    searchResults.innerHTML = '<p class="empty-state">No results found. Try a different query.</p>';
    searchInfo.textContent = `No results for "${escapeHtml(data.query)}" (checked ${data.tokens?.length || 0} tokens, took ${data.tookMs}ms)`;
    return;
  }

  searchInfo.textContent = `${data.total} results in ${data.tookMs}ms for "${escapeHtml(data.query)}" • Tokens: ${data.tokens?.join(', ') || 'none'}`;

  let html = '';
  for (const result of data.results) {
    html += `
      <div class="search-result">
        <a href="${escapeHtml(result.relevantUrl)}" target="_blank" rel="noopener" class="search-result-url">
          ${escapeHtml(result.relevantUrl)}
        </a>
        ${result.title ? `<div class="search-result-title">${escapeHtml(result.title)}</div>` : ''}
        <div class="search-result-meta">
          Origin: ${escapeHtml(result.originUrl)} • Depth: ${result.depth} • Score: <span class="score-badge">${result.score.toFixed(2)}</span>
        </div>
      </div>
    `;
  }

  searchResults.innerHTML = html;
}

// ── Job Actions (Pause/Resume/Cancel) ────────────────

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const jobId = btn.dataset.id;

  // Disable button during request
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = '...';

  try {
    let response;
    if (action === 'pause') {
      response = await fetch(`/api/index/${jobId}/pause`, { method: 'POST' });
    } else if (action === 'resume') {
      response = await fetch(`/api/index/${jobId}/resume`, { method: 'POST' });
    } else if (action === 'cancel') {
      response = await fetch(`/api/index/${jobId}`, { method: 'DELETE' });
    }

    const data = await response.json();

    if (response.ok) {
      // The SSE will update the UI, but we can do a quick refresh too
      fetch('/api/index')
        .then(r => r.json())
        .then(jobs => { currentJobs = jobs; renderJobs(jobs); })
        .catch(() => {});
    } else {
      alert(data.error || 'Action failed');
      btn.disabled = false;
      btn.textContent = originalText;
    }
  } catch (error) {
    alert('Network error: Action failed');
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

// ── Utility Functions ────────────────────────────────

function showFeedback(el, message, type) {
  el.textContent = message;
  el.className = `feedback ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

// ── Initialize ───────────────────────────────────────
connectSSE();

// Also do an initial fetch of jobs in case SSE takes a moment
fetch('/api/index')
  .then(r => r.json())
  .then(jobs => { currentJobs = jobs; renderJobs(jobs); })
  .catch(() => {});
