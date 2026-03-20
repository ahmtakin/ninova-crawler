# Ninova — Web Crawler & Search Engine

A self-contained web crawler and real-time search engine built with Node.js, MongoDB, and Redis. Crawl websites to a configurable depth, build a searchable word index, and query results — all through a live dashboard.

## Quick Start

### Prerequisites
- Docker & Docker Compose installed

### Run
```bash
git clone <repo-url>
cd ninova-crawler
docker-compose up --build
```

Open **http://localhost:3000** in your browser.

### Stop
```bash
docker-compose down
```

To also clear all data (MongoDB + Redis volumes):
```bash
docker-compose down -v
```

## How It Works

### 1. Start a Crawl

Enter a URL and depth on the dashboard, then click **Start Crawl**. The system will:
- Fetch the origin page using native Node.js HTTP modules
- Extract all links from the HTML using regex-based parsing
- Follow each link recursively up to the specified depth
- Build a word-frequency index for every crawled page
- Track progress in real-time on the dashboard

### 2. Search

Type a query in the search box at any time — even while crawling is active. Results are returned as triples:

| Field | Description |
|-------|-------------|
| relevant_url | The page matching your query |
| origin_url | The origin URL of the crawl that discovered it |
| depth | How many hops from the origin |

Results are ranked by keyword frequency, with bonuses for title matches and penalties for deeper pages.

### 3. Monitor

The dashboard shows live system status:
- **Crawl progress** — URLs processed vs. queued
- **Queue depth** — how many URLs are waiting
- **Back pressure** — whether the rate limiter or queue cap is active
- **Job controls** — pause, resume, or cancel any crawl

## Architecture

```
Browser ──► Express Server ──► MongoDB (storage)
                │                  ├── crawl_jobs
                │                  ├── pages
                │                  ├── word_index
                │                  └── crawl_queue
                ├──► Redis #1 (job queue / BullMQ)
                └──► Redis #2 (cache / visited sets)
```

### Back Pressure

The crawler implements two back pressure mechanisms:
1. **Rate limiting** — Token bucket algorithm caps requests per second (default: 10/s)
2. **Queue depth cap** — Pauses link discovery when pending URLs exceed a threshold (default: 10,000)

### Resumability

Crawl state is persisted in MongoDB. If the server restarts, in-progress jobs automatically resume from where they left off.

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/index` | Start a crawl `{ origin, depth, config? }` |
| `GET` | `/api/index` | List all crawl jobs |
| `GET` | `/api/index/:id` | Get job status and stats |
| `POST` | `/api/index/:id/pause` | Pause a crawl |
| `POST` | `/api/index/:id/resume` | Resume a paused crawl |
| `DELETE` | `/api/index/:id` | Cancel a crawl |
| `GET` | `/api/search?q=keyword` | Search indexed pages |
| `GET` | `/api/status/stream` | SSE stream for live updates |

## Configuration

Environment variables (set in `docker-compose.yml`):

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_QUEUE_DEPTH` | 10000 | Queue depth before back pressure kicks in |
| `MAX_REQUESTS_PER_SECOND` | 10 | Rate limit for HTTP fetches |
| `MAX_CONCURRENT_FETCHES` | 5 | Parallel HTTP connections |
| `REQUEST_TIMEOUT_MS` | 10000 | Timeout per HTTP request |

## Tech Stack

- **Runtime**: Node.js 20
- **Framework**: Express.js
- **Database**: MongoDB 7
- **Cache/Queue**: Redis 7 (two instances)
- **Containerization**: Docker + Docker Compose
- **Frontend**: Vanilla HTML/CSS/JS
- **HTML Parsing**: Regex-based (no cheerio/jsdom — language-native approach)
- **HTTP Client**: Native `http`/`https` modules (no axios/node-fetch)

## Project Structure

```
├── docker-compose.yml       # All services
├── Dockerfile               # Node.js app
├── CLAUDE.md                # AI coding instructions
├── product_prd.md           # Product requirements
├── recommendation.md        # Production roadmap
├── src/
│   ├── server.js            # Express + SSE
│   ├── config.js            # Configuration
│   ├── api/                 # REST endpoints
│   ├── crawler/             # Crawl engine + back pressure
│   ├── search/              # Indexer + search ranking
│   ├── db/                  # MongoDB + Redis connections
│   └── utils/               # URL normalization, logging
├── public/                  # Dashboard UI
└── tests/                   # Unit tests
```

## License

MIT
