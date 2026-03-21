# CLAUDE.md — Master Build Instructions for Ninova Crawler

## Project Overview

Ninova is a web crawler and search engine with two core capabilities:
1. **index(origin, k)** — Crawl the web starting from `origin` URL to depth `k`, storing page content and building a searchable word index.
2. **search(query)** — Return relevant URLs as triples `(relevant_url, origin_url, depth)` ranked by relevance. Must work concurrently while indexing is active.

## Critical Constraints

- **Language-native HTTP**: Use Node.js built-in `http`/`https` modules for fetching pages. Do NOT use `axios`, `node-fetch`, `got`, or similar.
- **Native HTML parsing**: Use regex-based or custom string parsing to extract links and text from HTML. Do NOT use `cheerio`, `jsdom`, `htmlparser2`, or `BeautifulSoup`-equivalents. The built-in `URL` class is allowed for URL resolution.
- **Concurrency safety**: All shared state must be thread-safe. Use proper locking patterns with MongoDB/Redis.
- **Back pressure**: The crawler MUST implement back pressure — configurable max queue depth and rate limiting (requests per second).
- **Resumability**: Crawl jobs must be resumable after server restart without losing progress.

## Tech Stack (Mandatory)

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js (v20+) |
| Web Framework | Express.js |
| Primary Database | MongoDB (stores crawl jobs, pages, word index, crawl queue) |
| Cache | Redis — Search result caching, visited URL deduplication |
| Containerization | Docker + Docker Compose |
| Frontend | Vanilla HTML/CSS/JS (served by Express static) |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Express Server                    │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ /api/    │  │ /api/    │  │ /api/status       │  │
│  │ index    │  │ search   │  │ (SSE stream)      │  │
│  └────┬─────┘  └────┬─────┘  └───────────────────┘  │
│       │              │                               │
│  ┌────▼──────────────▼───────────────────────────┐   │
│  │              Core Services                     │   │
│  │  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │   │
│  │  │ Crawler  │  │ Searcher │  │ BackPressure│  │   │
│  │  │ Manager  │  │ Engine   │  │ Controller  │  │   │
│  │  └────┬─────┘  └────┬─────┘  └──────┬──────┘  │   │
│  └───────┼──────────────┼───────────────┼─────────┘   │
│          │              │               │             │
│  ┌───────▼──────────────▼───────────────▼─────────┐   │
│  │              Data Layer                         │   │
│  │  ┌─────────┐  ┌─────────────────────────────┐  │   │
│  │  │ MongoDB │  │ Redis                       │  │   │
│  │  │ (store) │  │ (cache + visited sets)      │  │   │
│  │  └─────────┘  └─────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## File Structure

```
ninova-crawler/
├── docker-compose.yml          # MongoDB + Redis + App
├── Dockerfile                  # Node.js app container
├── .dockerignore
├── package.json
├── CLAUDE.md                   # THIS FILE
├── readme.md                   # Human-readable project docs
├── product_prd.md              # Product Requirements Document
├── recommendation.md           # Production deployment recommendations
├── src/
│   ├── server.js               # Express app + SSE endpoints
│   ├── config.js               # All configuration (env vars)
│   ├── api/
│   │   ├── routes.js           # Mount all API routes
│   │   ├── indexController.js  # POST /api/index, GET /api/index/:id
│   │   └── searchController.js # GET /api/search?q=...
│   ├── crawler/
│   │   ├── crawlManager.js     # Orchestrates crawl jobs, manages workers
│   │   ├── fetcher.js          # Native https.get / http.get wrapper
│   │   ├── parser.js           # Regex-based HTML link + text extraction
│   │   ├── urlQueue.js         # Redis-backed URL queue with back pressure
│   │   └── backpressure.js     # Rate limiter (token bucket) + queue depth monitor
│   ├── search/
│   │   ├── indexer.js          # Tokenize page text → inverted index in MongoDB
│   │   └── searcher.js         # Query parsing, scoring, ranking, result assembly
│   ├── db/
│   │   ├── mongo.js            # MongoDB connection + graceful shutdown
│   │   ├── redis.js            # Redis connection (cache + visited sets)
│   │   └── models.js           # MongoDB collection schemas & indexes
│   └── utils/
│       ├── logger.js           # Structured logging utility
│       └── urlUtils.js         # URL normalization, validation, same-domain checks
├── public/
│   ├── index.html              # Main dashboard UI (single page)
│   ├── style.css               # Dashboard styles
│   └── app.js                  # Frontend JS (fetch API, SSE, DOM updates)
└── tests/
    ├── parser.test.js          # Test HTML parsing
    ├── urlUtils.test.js        # Test URL normalization
    └── searcher.test.js        # Test search ranking
```

## Implementation Plan — Step by Step

### Phase 1: Infrastructure & Data Layer

**Step 1.1: `src/config.js`**
- Export a frozen config object reading from `process.env` with defaults:
  - `PORT`: 3000
  - `MONGO_URI`: `mongodb://mongo:27017/ninova`
  - `REDIS_CACHE_URL`: `redis://redis-cache:6379`
  - `MAX_QUEUE_DEPTH`: 10000 (back pressure trigger)
  - `MAX_REQUESTS_PER_SECOND`: 10 (rate limit)
  - `MAX_CONCURRENT_FETCHES`: 5 (concurrent HTTP connections)
  - `REQUEST_TIMEOUT_MS`: 10000
  - `MAX_PAGE_SIZE_BYTES`: 5 * 1024 * 1024 (5MB)
  - `USER_AGENT`: `NinovaCrawler/1.0`

**Step 1.2: `src/db/mongo.js`**
- Create a singleton MongoDB client using the official `mongodb` driver (this is allowed — it's a DB driver, not a crawler library).
- Export `connect()`, `getDb()`, `close()`.
- On connect, create the indexes defined in models.js.

**Step 1.3: `src/db/redis.js`**
- Create two separate Redis connections using `ioredis`:
  - `queueRedis` — for BullMQ job queue
  - `cacheRedis` — for visited URL sets, search caching
- Export both clients and a `closeAll()` function.

**Step 1.4: `src/db/models.js`**
- Define MongoDB collection names and their indexes:

```
Collection: crawl_jobs
Fields: {
  _id: ObjectId,
  origin: string,          // origin URL
  maxDepth: number,        // k value
  status: "queued" | "running" | "paused" | "completed" | "failed",
  config: {
    maxQueueDepth: number,
    maxRequestsPerSecond: number,
    maxConcurrentFetches: number
  },
  stats: {
    urlsQueued: number,
    urlsProcessed: number,
    urlsFailed: number,
    pagesIndexed: number,
    startedAt: Date | null,
    completedAt: Date | null,
    lastActivityAt: Date
  },
  createdAt: Date,
  updatedAt: Date
}
Indexes: { origin: 1, status: 1 }

Collection: pages
Fields: {
  _id: ObjectId,
  url: string,             // normalized URL of this page
  crawlJobId: ObjectId,    // reference to crawl_jobs
  origin: string,          // origin URL of the crawl job
  depth: number,           // depth at which this page was found
  title: string,           // extracted <title> content
  statusCode: number,      // HTTP status code
  contentType: string,
  textContent: string,     // stripped text (truncated to 50KB)
  links: [string],         // discovered outgoing URLs
  wordCount: number,
  fetchedAt: Date,
  indexedAt: Date | null
}
Indexes:
  { url: 1, crawlJobId: 1 } (unique)
  { crawlJobId: 1, depth: 1 }
  { indexedAt: 1 }

Collection: word_index
Fields: {
  _id: ObjectId,
  word: string,            // lowercased, stemmed token
  url: string,             // page URL where word appears
  crawlJobId: ObjectId,
  origin: string,          // crawl job origin
  depth: number,           // page depth
  frequency: number,       // occurrence count on this page
  inTitle: boolean,        // whether word appears in title
  position: "title" | "body" | "both"
}
Indexes:
  { word: 1, crawlJobId: 1 }
  { word: 1 }
  { url: 1, crawlJobId: 1 }

Collection: crawl_queue
Fields: {
  _id: ObjectId,
  crawlJobId: ObjectId,
  url: string,
  depth: number,
  status: "pending" | "processing" | "done" | "failed",
  createdAt: Date,
  processedAt: Date | null
}
Indexes:
  { crawlJobId: 1, status: 1 }
  { crawlJobId: 1, url: 1 } (unique)
```

- Export a function `ensureIndexes(db)` that creates all indexes.

### Phase 2: Crawler Core

**Step 2.1: `src/utils/urlUtils.js`**
- `normalizeUrl(rawUrl, baseUrl)` — Resolve relative URLs against base, strip fragments, strip trailing slashes, lowercase hostname, sort query params. Return null for non-http(s) URLs.
- `isValidUrl(url)` — Check protocol is http/https, hostname exists.
- `isSameDomain(url1, url2)` — Compare hostnames (for optional same-domain restriction).

**Step 2.2: `src/crawler/parser.js`**
- `extractLinks(html, baseUrl)` — Use regex to find all `href` attributes in `<a>` tags. Resolve relative URLs. Return array of normalized absolute URLs. Filter out javascript:, mailto:, tel:, #-only links.
  - Regex pattern: `/<a[^>]+href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/gi`
- `extractTitle(html)` — Regex to extract content between `<title>` tags.
- `extractText(html)` — Strip all HTML tags, decode common HTML entities (&amp; &lt; &gt; &quot; &#39; &nbsp;), collapse whitespace. Return clean text string.
- `extractMetaDescription(html)` — Regex for meta description content.

**Step 2.3: `src/crawler/fetcher.js`**
- `fetchPage(url, options)` — Uses native `https.get` or `http.get` based on protocol.
  - Set `User-Agent` header.
  - Follow redirects (up to 5 max), handling 301/302/307/308.
  - Enforce timeout from config.
  - Enforce max body size (abort if Content-Length exceeds limit or accumulated data exceeds limit).
  - Return `{ statusCode, headers, body, finalUrl }` or throw on error/timeout.
  - Handle HTTPS and HTTP separately using the correct module.
  - Check `robots.txt` compliance (optional, nice-to-have).

**Step 2.4: `src/crawler/backpressure.js`**
- **Token Bucket Rate Limiter**:
  - Constructor takes `maxTokens` (= max requests/sec) and `refillRate`.
  - `async acquire()` — Wait until a token is available. Use a Promise-based approach with setTimeout.
  - `getStatus()` — Return `{ availableTokens, maxTokens, isThrottled }`.
- **Queue Depth Monitor**:
  - Constructor takes `maxDepth`.
  - `check(currentDepth)` — Returns `{ isOverLimit, currentDepth, maxDepth, utilizationPercent }`.
  - `shouldPause(currentDepth)` — Returns true if queue depth > maxDepth.

**Step 2.5: `src/crawler/crawlManager.js`**
This is the main orchestrator. It manages the crawl lifecycle.

- `startCrawl(origin, maxDepth, config)`:
  1. Create a `crawl_jobs` document in MongoDB with status "queued".
  2. Add the origin URL to `crawl_queue` collection with depth 0.
  3. Add origin URL to the Redis visited set: `visited:{jobId}`.
  4. Update job status to "running".
  5. Start the crawl loop (see below).
  6. Return the job ID immediately (don't await completion).

- **Crawl Loop** (runs as an async function, not blocking):
  1. Fetch the next batch of "pending" URLs from `crawl_queue` (limit by `maxConcurrentFetches`).
  2. Mark them as "processing" in `crawl_queue`.
  3. For each URL in parallel (using `Promise.allSettled`):
     a. `await rateLimiter.acquire()` — Wait for rate limit token.
     b. Check back pressure: if queue depth > max, pause and wait.
     c. `fetchPage(url)` — Fetch the page.
     d. `parser.extractLinks(html, url)` — Get links.
     e. `parser.extractText(html)` — Get text.
     f. `parser.extractTitle(html)` — Get title.
     g. Store page data in `pages` collection.
     h. Call `indexer.indexPage(pageData)` — Build word index.
     i. For each discovered link (if current depth < maxDepth):
        - Normalize the URL.
        - Check Redis visited set (`SADD visited:{jobId} url` — returns 1 if new).
        - If new, insert into `crawl_queue` with depth+1.
     j. Mark URL as "done" in `crawl_queue`.
     k. Update `crawl_jobs.stats` (increment counters).
  4. Repeat until no more "pending" URLs exist.
  5. Update job status to "completed".

- `getJobStatus(jobId)` — Return current job document from MongoDB.
- `pauseJob(jobId)` / `resumeJob(jobId)` — Set status flag, crawl loop checks this.
- `getAllJobs()` — List all crawl jobs with stats.

### Phase 3: Search Engine

**Step 3.1: `src/search/indexer.js`**
- `indexPage(pageData)`:
  1. Tokenize `textContent`: lowercase, split on non-alphanumeric, filter stop words, filter tokens < 2 chars.
  2. Count word frequencies.
  3. Also tokenize the title separately.
  4. For each unique word, upsert into `word_index`:
     - `{ word, url, crawlJobId, origin, depth, frequency, inTitle: boolean }`.
  5. Update the page's `indexedAt` timestamp.
- `STOP_WORDS` — A set of ~150 common English stop words (the, a, an, is, etc.).

**Step 3.2: `src/search/searcher.js`**
- `search(query, options)`:
  1. Tokenize the query the same way as indexer (lowercase, split, remove stop words).
  2. For each query token, find matching documents in `word_index`.
  3. Group results by URL.
  4. Score each URL:
     - Base score = sum of `frequency` for matched words.
     - Title bonus: multiply score by 3 if word appears in title.
     - Multi-word bonus: multiply by number of distinct query words matched.
     - Depth penalty: divide score by (depth + 1) — prefer shallower pages.
  5. Sort by score descending.
  6. Return triples: `[{ relevantUrl, originUrl, depth, score }]`.
  7. Apply pagination (limit/offset).
  8. Optionally cache results in Redis with a short TTL (30 seconds) since index is live-updating.

### Phase 4: API Layer

**Step 4.1: `src/api/indexController.js`**
- `POST /api/index` — Body: `{ origin: string, depth: number, config?: { maxQueueDepth?, maxRequestsPerSecond?, maxConcurrentFetches? } }`.
  - Validate origin is a valid URL, depth is a positive integer ≤ 10.
  - Call `crawlManager.startCrawl(...)`.
  - Return `{ jobId, status: "queued", origin, depth }`.
- `GET /api/index/:id` — Return job status + stats.
- `GET /api/index` — List all jobs.
- `DELETE /api/index/:id` — Cancel/stop a crawl job.
- `POST /api/index/:id/pause` — Pause a running job.
- `POST /api/index/:id/resume` — Resume a paused job.

**Step 4.2: `src/api/searchController.js`**
- `GET /api/search?q=<query>&limit=20&offset=0`
  - Validate query is non-empty.
  - Call `searcher.search(query, { limit, offset })`.
  - Return `{ query, results: [...triples], total, took_ms }`.

**Step 4.3: `src/api/routes.js`**
- Mount index and search controllers.
- Add `GET /api/status/stream` — SSE endpoint that pushes system status every 2 seconds:
  ```json
  {
    "jobs": [...],
    "system": {
      "totalUrlsQueued": number,
      "totalUrlsProcessed": number,
      "activeJobs": number,
      "backPressureActive": boolean,
      "rateLimitStatus": {...}
    }
  }
  ```

**Step 4.4: `src/server.js`**
- Initialize Express.
- Serve static files from `public/`.
- Connect to MongoDB and Redis on startup.
- Mount API routes.
- Graceful shutdown: close DB connections on SIGTERM/SIGINT.
- Resume any "running" crawl jobs on startup (resumability).

### Phase 5: Frontend Dashboard

**Step 5.1: `public/index.html`**
Single-page dashboard with three sections:
1. **Start Crawl** — Form: origin URL, depth, optional config fields. Submit button.
2. **Crawl Jobs** — Live-updating table of all jobs with: origin, depth, status, progress bar (processed/queued), queue depth, back pressure indicator, actions (pause/resume/cancel).
3. **Search** — Search input + results list showing triples (relevant_url, origin_url, depth) with relevance scores.

**Step 5.2: `public/app.js`**
- Connect to SSE endpoint for live updates.
- Fetch and render job list.
- Handle form submissions (start crawl, search).
- Auto-refresh job stats.
- Display back pressure warnings visually.

**Step 5.3: `public/style.css`**
- Clean, functional dashboard design.
- Status indicators (green = running, yellow = paused, red = failed, blue = completed).
- Progress bars for crawl progress.
- Back pressure warning styling.

### Phase 6: Docker & Testing

**Step 6.1: Verify `docker-compose.yml` and `Dockerfile`**
- Ensure all services start correctly.
- Health checks for MongoDB and Redis.
- Volume mounts for data persistence.

**Step 6.2: Write basic tests**
- Test HTML parser with various HTML samples.
- Test URL normalization edge cases.
- Test search ranking logic.

## Coding Standards

- Use `async/await` throughout, never raw callbacks.
- All errors must be caught and logged — never let the process crash silently.
- Use JSDoc comments on all exported functions.
- Use `const` by default, `let` only when reassignment is needed, never `var`.
- Prefer `for...of` over `forEach` for async iteration.
- Use structured logging (JSON format) with timestamps.
- Every MongoDB query should have a timeout option.
- Every HTTP fetch must have a timeout.
- Gracefully handle connection losses to MongoDB/Redis — retry with backoff.

## Important Reminders

1. **NO cheerio, jsdom, puppeteer, playwright** — parse HTML with regex.
2. **NO axios, node-fetch, got** — use native `http`/`https` modules.
3. **DO use**: `mongodb` driver, `ioredis`, `bullmq`, `express` — these are infrastructure libraries, not crawler libraries.
4. The `URL` built-in class is allowed and encouraged for URL parsing/resolution.
5. Search MUST work while crawling is in progress — this is a core requirement.
6. Back pressure is a core requirement — not optional.
7. The system must be resumable after restart.
