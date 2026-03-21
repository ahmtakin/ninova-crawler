# Product Requirements Document — Ninova Web Crawler & Search Engine

## 1. Summary

Ninova is a self-contained web crawler and search engine designed to run on a single machine. It exposes two core APIs: an **indexer** that recursively crawls web pages from a given origin URL to a configurable depth, and a **searcher** that returns relevant URLs ranked by a keyword-frequency heuristic. The system emphasizes concurrency safety, back pressure management, and resumability, all exposed through a real-time dashboard UI.

## 2. Goals

- Crawl web pages starting from any URL to a specified depth without visiting duplicates.
- Build an inverted word index that supports concurrent reads during active crawling.
- Provide a search API that returns ranked results as `(relevant_url, origin_url, depth)` triples.
- Implement meaningful back pressure controls: rate limiting and queue depth caps.
- Offer a dashboard showing live crawl progress, queue state, and system health.
- Support resumption after interruption without restarting crawls from scratch.

## 3. Non-Goals

- Multi-machine distributed crawling (designed for single-node scale).
- Full-text search with NLP, stemming, or semantic understanding.
- JavaScript rendering (SPA support) — only static HTML is parsed.
- Respecting robots.txt (nice-to-have but not required for this exercise).
- User authentication or multi-tenancy.

## 4. Technical Requirements

### 4.1 Indexer (`POST /api/index`)

**Input**: `{ origin: string, depth: number, config?: {...} }`

**Behavior**:
- Creates a crawl job and begins recursive crawling from `origin`.
- At each page, extracts all `<a href>` links and follows them if depth < k.
- Maintains a visited-URL set (Redis) to guarantee each URL is crawled at most once per job.
- Stores page content, extracted text, and word frequencies in MongoDB.
- Builds an inverted word index for the search engine.
- Implements back pressure via a token-bucket rate limiter and max queue depth.
- Persists queue state in MongoDB so jobs can be resumed after server restart.
- Reports progress via an SSE (Server-Sent Events) endpoint.

**Back Pressure Mechanisms**:
1. **Rate Limiting**: Token bucket algorithm — configurable max requests per second (default: 10/s).
2. **Queue Depth Cap**: When pending URLs exceed the configured limit (default: 10,000), the crawler pauses discovery of new URLs until the queue drains.
3. **Concurrent Fetch Limit**: At most N pages fetched in parallel (default: 5).

### 4.2 Searcher (`GET /api/search`)

**Input**: `?q=<query>&limit=20&offset=0`

**Output**: Array of `{ relevantUrl, originUrl, depth, score }`

**Ranking Heuristic**:
- Tokenize query into lowercase words, removing stop words.
- Look up each token in the inverted word index (MongoDB).
- Score = Σ(frequency) × title_bonus × multi_word_bonus / (depth + 1)
  - `title_bonus`: 3× if the word appears in the page title.
  - `multi_word_bonus`: multiplied by count of distinct query words matched.
  - `depth_penalty`: shallower pages score higher.
- Results sorted by score descending.

**Concurrency**: Search reads from MongoDB, which supports concurrent reads during active writes. The inverted index is updated incrementally as pages are crawled, so search results reflect the latest state.

### 4.3 Dashboard UI

Single-page web application served by Express static middleware.

**Sections**:
1. **Start Crawl**: Form with origin URL, depth, optional back pressure config.
2. **Active Jobs**: Live-updating table with progress bars, queue depth, back pressure status, and action buttons (pause/resume/cancel).
3. **Search**: Query input with results displayed as clickable triples.

**Live Updates**: SSE connection pushes system status every 2 seconds.

### 4.4 Persistence & Resumability

- Crawl queue is stored in MongoDB (`crawl_queue` collection), not just in memory.
- On server startup, any jobs with status "running" are automatically resumed.
- The visited-URL set is reconstructed from the `crawl_queue` collection on resume.

## 5. Data Model

### crawl_jobs
Stores metadata and stats for each crawl operation.

### pages
Stores fetched page content, extracted text, links, and metadata.

### word_index
Inverted index mapping words to page URLs with frequency and position data.

### crawl_queue
Persistent URL queue with status tracking for resumability.

## 6. API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/index | Start a new crawl job |
| GET | /api/index | List all crawl jobs |
| GET | /api/index/:id | Get specific job status & stats |
| POST | /api/index/:id/pause | Pause a running job |
| POST | /api/index/:id/resume | Resume a paused job |
| DELETE | /api/index/:id | Cancel a job |
| GET | /api/search | Search indexed pages |
| GET | /api/status/stream | SSE stream for live system status |

## 7. Configuration

All values configurable via environment variables with sensible defaults.

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | Server port |
| MONGO_URI | mongodb://mongo:27017/ninova | MongoDB connection |
| REDIS_CACHE_URL | redis://redis-cache:6379 | Redis for caching |
| MAX_QUEUE_DEPTH | 10000 | Back pressure queue limit |
| MAX_REQUESTS_PER_SECOND | 10 | Rate limit |
| MAX_CONCURRENT_FETCHES | 5 | Parallel HTTP connections |
| REQUEST_TIMEOUT_MS | 10000 | HTTP timeout per request |
| MAX_PAGE_SIZE_BYTES | 5242880 | Max page body size (5MB) |

## 8. Success Criteria

- Crawler accurately follows links to the specified depth without duplicates.
- Search returns relevant results while crawling is still active.
- Back pressure visibly throttles the crawler when queue depth is exceeded.
- Dashboard shows real-time progress with no stale data.
- System resumes gracefully after docker-compose restart.
