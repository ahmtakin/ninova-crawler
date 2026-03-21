# Redis Queue Service Sunset Plan

> **Status:** Proposed
> **Date:** 2026-03-22
> **Service:** `redis-queue` (BullMQ Job Queue)
> **Reason:** Completely unused - URL queue implemented in MongoDB instead

---

## Executive Summary

The `redis-queue` service was planned for BullMQ job queue management but was never implemented. The URL queue uses MongoDB (`crawl_queue` collection) instead. This service consumes ~256MB memory and adds unnecessary complexity.

**Impact:** Remove ~256MB memory usage, simplify architecture, reduce maintenance surface.

---

## Audit: All References to `redis-queue`

### Source Code
| File | Lines | Reference |
|------|-------|-----------|
| `src/config.js` | 11 | `redisQueueUrl` config variable |
| `src/db/redis.js` | 3, 23, 24, 76-78, 121 | `queueRedis` connection, `getQueueRedis()` |
| `package.json` | 19 | `bullmq` dependency |

### Infrastructure
| File | Lines | Reference |
|------|-------|-----------|
| `docker-compose.yml` | 14, 24-25, 50-66 | Service definition, env var, dependency, volume, port |
| `.dockerignore` | - | (check if redis-queue volume exclusion needed) |

### Documentation
| File | Lines | Reference |
|------|-------|-----------|
| `CLAUDE.md` | 50, 126 | Architecture diagram, Redis #1 description |
| `readme.md` | 68 | Architecture diagram (`Redis #1 (job queue / BullMQ)`) |
| `product_prd.md` | 114 | `REDIS_QUEUE_URL` config table |

**Note:** `recommendation.md` mentions BullMQ as a production recommendation, not current implementation (no change needed).

---

## Step-by-Step Sunset Plan

### Phase 1: Code Changes (Priority 1)

#### Step 1.1: Remove `bullmq` dependency
**File:** `package.json`

```diff
-   "bullmq": "^5.13.0",
```

**Command:**
```bash
npm uninstall bullmq
```

#### Step 1.2: Remove `redisQueueUrl` config
**File:** `src/config.js`

```diff
-  redisQueueUrl: process.env.REDIS_QUEUE_URL || 'redis://localhost:6379',
```

#### Step 1.3: Remove `queueRedis` from Redis connection manager
**File:** `src/db/redis.js`

Remove lines containing `queueRedis`:

```diff
 /**
  * Redis connection manager — two separate instances.
- * - queueRedis: for BullMQ job queue management
  * - cacheRedis: for visited URL sets and search result caching
  */

 const Redis = require('ioredis');
 const config = require('../config');
 const logger = require('../utils/logger');

-let queueRedis = null;
 let cacheRedis = null;

 /**
  * Initialize both Redis connections.
  */
 async function connect() {
-  if (queueRedis && cacheRedis) {
+  if (cacheRedis) {
     return;
   }

   try {
-    // Redis for BullMQ job queue
-    queueRedis = new Redis(config.redisQueueUrl, {
-      maxRetriesPerRequest: 3,
-      retryStrategy: (times) => {
-        const delay = Math.min(times * 50, 2000);
-        return delay;
-      },
-      reconnectOnError: (err) => {
-        const targetError = 'READONLY';
-        if (err.message.includes(targetError)) {
-          return true;
-        }
-        return false;
-      }
-    });

     // Redis for caching and visited URL tracking
     cacheRedis = new Redis(config.redisCacheUrl, {
       maxRetriesPerRequest: 3,
       retryStrategy: (times) => {
         const delay = Math.min(times * 50, 2000);
         return delay;
       },
       reconnectOnError: (err) => {
         const targetError = 'READONLY';
         if (err.message.includes(targetError)) {
           return true;
         }
         return false;
       }
     });

     // Wait for connections
-    await Promise.all([
-      new Promise((resolve, reject) => {
-        queueRedis.on('ready', resolve);
-        queueRedis.on('error', reject);
-      }),
-      new Promise((resolve, reject) => {
+    await new Promise((resolve, reject) => {
         cacheRedis.on('ready', resolve);
         cacheRedis.on('error', reject);
-      })
     ]);

-    logger.info('Both Redis instances connected successfully');
+    logger.info('Redis connected successfully');

   } catch (error) {
     logger.error('Failed to connect to Redis', { error: error.message });
     throw error;
   }
 }

-/**
- * @returns {import('ioredis').Redis} Redis client for job queue
- */
-function getQueueRedis() {
-  if (!queueRedis) throw new Error('Queue Redis not connected');
-  return queueRedis;
-}

 /**
  * @returns {import('ioredis').Redis} Redis client for caching
  */
 function getCacheRedis() {
   if (!cacheRedis) throw new Error('Cache Redis not connected');
   return cacheRedis;
 }

 /**
  * Close all Redis connections gracefully.
  */
 async function closeAll() {
   const closePromises = [];

-  if (queueRedis) {
-    closePromises.push(
-      queueRedis.quit().catch(err => {
-        logger.error('Error closing queue Redis connection', { error: err.message });
-      })
-    );
-  }

   if (cacheRedis) {
     closePromises.push(
       cacheRedis.quit().catch(err => {
         logger.error('Error closing cache Redis connection', { error: err.message });
       })
     );
   }

   await Promise.all(closePromises);

-  queueRedis = null;
   cacheRedis = null;

-  logger.info('All Redis connections closed');
+  logger.info('Redis connection closed');
 }

-module.exports = { connect, getQueueRedis, getCacheRedis, closeAll };
+module.exports = { connect, getCacheRedis, closeAll };
```

#### Step 1.4: Update header JSDoc comment
**File:** `src/db/redis.js`

```diff
 /**
- * Redis connection manager — two separate instances.
- * - queueRedis: for BullMQ job queue management
- * - cacheRedis: for visited URL sets and search result caching
+ * Redis connection manager.
+ *
+ * Manages a single Redis instance for:
+ * - Visited URL sets (deduplication via SADD)
+ * - Search result caching
  */
```

---

### Phase 2: Infrastructure Changes (Priority 1)

#### Step 2.1: Remove `redis-queue` service from docker-compose
**File:** `docker-compose.yml`

```diff
 version: "3.8"

 services:
   # ── Node.js Application ──────────────────────────────
   app:
     build: .
     container_name: ninova-app
     ports:
       - "3000:3000"
     environment:
       - NODE_ENV=production
       - PORT=3000
       - MONGO_URI=mongodb://mongo:27017/ninova
-      - REDIS_QUEUE_URL=redis://redis-queue:6379
       - REDIS_CACHE_URL=redis://redis-cache:6379
       - MAX_QUEUE_DEPTH=10000
       - MAX_REQUESTS_PER_SECOND=10
       - MAX_CONCURRENT_FETCHES=5
       - REQUEST_TIMEOUT_MS=10000
       - MAX_PAGE_SIZE_BYTES=5242880
     depends_on:
       mongo:
         condition: service_healthy
-      redis-queue:
-        condition: service_healthy
       redis-cache:
         condition: service_healthy
     restart: unless-stopped
     networks:
       - ninova-net

   # ── MongoDB ──────────────────────────────────────────
   mongo:
     image: mongo:7
     container_name: ninova-mongo
     ports:
       - "27017:27017"
     volumes:
       - mongo-data:/data/db
     healthcheck:
       test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
       interval: 10s
       timeout: 5s
       retries: 5
       start_period: 10s
     restart: unless-stopped
     networks:
       - ninova-net

-  # ── Redis #1: Job Queue (BullMQ) ────────────────────
-  redis-queue:
-    image: redis:7-alpine
-    container_name: ninova-redis-queue
-    ports:
-      - "6379:6379"
-    volumes:
-      - redis-queue-data:/data
-    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy noeviction
-    healthcheck:
-      test: ["CMD", "redis-cli", "ping"]
-      interval: 10s
-      timeout: 5s
- retries: 5
-    restart: unless-stopped
-    networks:
-      - ninova-net
-
   # ── Redis #2: Cache & Visited Sets ──────────────────
   redis-cache:
     image: redis:7-alpine
     container_name: ninova-redis-cache
     ports:
       - "6380:6379"
     volumes:
       - redis-cache-data:/data
     command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
     healthcheck:
       test: ["CMD", "redis-cli", "ping"]
       interval: 10s
       timeout: 5s
       retries: 5
     restart: unless-stopped
     networks:
       - ninova-net

 volumes:
   mongo-data:
-  redis-queue-data:
   redis-cache-data:

 networks:
   ninova-net:
     driver: bridge
```

#### Step 2.2: Update `redis-cache` port mapping (optional)
**File:** `docker-compose.yml`

Since `redis-queue` used port 6379, you may want to move `redis-cache` to the default Redis port for consistency:

```diff
   redis-cache:
     image: redis:7-alpine
     container_name: ninova-redis-cache
     ports:
-      - "6380:6379"
+      - "6379:6379"
```

Then update the `REDIS_CACHE_URL` env var if you made this change.

---

### Phase 3: Documentation Updates (Priority 2)

#### Step 3.1: Update `CLAUDE.md`
**File:** `CLAUDE.md`

**Remove lines containing `redis-queue` references:**

```diff
 │  ├──────────────┬──────────────┬─────────────────┐
 │  │ MongoDB      │ Redis #1     │ Redis #2        │
 │  │ (store)      │ (queue)      │ (cache)         │
```

**Change to:**

```diff
 │  ├──────────────┬─────────────────┐
 │  │ MongoDB      │ Redis           │
 │  │ (store)      │ (cache)         │
```

Also update the tech stack table:

```diff
 | Component     | Technology |
 |---------------|------------|
-| Queue & Cache | Redis #1 — Job queue management (BullMQ) |
-| Search Cache  | Redis #2 — Search result caching, visited URL dedup |
+| Cache         | Redis — Search result caching, visited URL dedup |
```

And remove the env var from the list:

```diff
 ### Step 1.1: `src/config.js`
 - Export a frozen config object reading from `process.env` with defaults:
   - `PORT`: 3000
   - `MONGO_URI`: `mongodb://mongo:27017/ninova`
-  - `REDIS_QUEUE_URL`: `redis://redis-queue:6379`
   - `REDIS_CACHE_URL`: `redis://redis-cache:6379`
```

#### Step 3.2: Update `readme.md`
**File:** `readme.md`

Update architecture diagram:

```diff
 ## Architecture

 ```
 Browser ──► Express Server ──► MongoDB (storage)
               │                  ├── crawl_jobs
               │                  ├── pages
               │                  ├── word_index
               │                  └── crawl_queue
-              ├──► Redis #1 (job queue / BullMQ)
-              └──► Redis #2 (cache / visited sets)
+              └──► Redis (cache / visited sets)
 ```
```

Update tech stack:

```diff
 | **Runtime**: Node.js 20
 | **Framework**: Express.js
 | **Database**: MongoDB 7
-| **Cache/Queue**: Redis 7 (two instances)
+| **Cache**: Redis 7
 | **Containerization**: Docker + Docker Compose
```

#### Step 3.3: Update `product_prd.md`
**File:** `product_prd.md`

Remove from config table:

```diff
 | PORT | 3000 | Server port |
 | MONGO_URI | mongodb://mongo:27017/ninova | MongoDB connection |
-| REDIS_QUEUE_URL | redis://redis-queue:6379 | Redis for job queue |
 | REDIS_CACHE_URL | redis://redis-cache:6379 | Redis for caching |
```

---

### Phase 4: Testing & Verification

#### Step 4.1: Clean rebuild
```bash
# Stop all services
docker compose down

# Remove unused volumes (WARNING: deletes redis-queue data)
docker volume rm ninova-crawler_redis-queue-data

# Rebuild and start
docker compose up -d --build
```

#### Step 4.2: Verify services
```bash
# Check only 2 services running (app, mongo, redis-cache)
docker compose ps

# Expected output:
# NAME                   STATUS
# ninova-app             Up
# ninova-mongo           Up
# ninova-redis-cache     Up
```

#### Step 4.3: Verify Redis connection
```bash
# Connect to redis-cache
docker compose exec redis-cache redis-cli KEYS "*"

# Should see visited:{jobId} keys after starting a crawl
```

#### Step 4.4: Test crawl functionality
1. Start a crawl job via dashboard
2. Verify logs show "Redis connected successfully" (not "Both Redis instances")
3. Verify crawl progresses normally
4. Verify visited URL deduplication works

#### Step 4.5: Verify resumability
```bash
# Restart services
docker compose restart

# Check logs - should show interrupted jobs resumed
docker compose logs app | grep "Resumed interrupted job"
```

---

### Phase 5: Cleanup

#### Step 5.1: Remove old volume (if not done in Phase 4)
```bash
docker volume rm ninova-crawler_redis-queue-data
```

#### Step 5.2: Verify no zombie containers
```bash
docker ps -a | grep redis-queue
# Should return nothing
```

---

## Rollback Plan

If issues arise after deployment:

1. **Quick rollback** - Revert commits:
   ```bash
   git revert <commit-hash>
   docker compose up -d --build
   ```

2. **Data recovery** - Old `redis-queue` volume already empty (no data to recover)

3. **Service dependency** - If something unexpectedly used `getQueueRedis()`, the app will fail fast with clear error

---

## Success Criteria

- [ ] `bullmq` removed from `package.json`
- [ ] `redis-queue` service removed from `docker-compose.yml`
- [ ] `redis-queue-data` volume removed
- [ ] No `queueRedis` references in codebase
- [ ] No `REDIS_QUEUE_URL` env var
- [ ] Documentation updated (CLAUDE.md, readme.md, product_prd.md)
- [ ] `docker compose ps` shows 3 services (app, mongo, redis-cache)
- [ ] Crawl functionality works normally
- [ ] Resumability works after restart
- [ ] ~256MB memory saved

---

## Estimated Impact

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Running Services | 4 | 3 | -1 |
| Memory Usage | ~768MB | ~512MB | -256MB |
| Docker Volumes | 3 | 2 | -1 |
| NPM Dependencies | 4 | 3 | -1 (bullmq) |
| Code Lines (redis.js) | ~122 | ~70 | -52 |

---

## Approval

- [ ] Developer review
- [ ] Test verification
- [ ] Documentation review

---

## Implementation Checklist

- [ ] Phase 1: Code changes
  - [ ] Step 1.1: Remove bullmq from package.json
  - [ ] Step 1.2: Remove redisQueueUrl from config.js
  - [ ] Step 1.3: Remove queueRedis from redis.js
  - [ ] Step 1.4: Update JSDoc comments
- [ ] Phase 2: Infrastructure changes
  - [ ] Step 2.1: Remove redis-queue from docker-compose.yml
  - [ ] Step 2.2: (Optional) Update redis-cache port mapping
- [ ] Phase 3: Documentation updates
  - [ ] Step 3.1: Update CLAUDE.md
  - [ ] Step 3.2: Update readme.md
  - [ ] Step 3.3: Update product_prd.md
- [ ] Phase 4: Testing
  - [ ] Step 4.1: Clean rebuild
  - [ ] Step 4.2: Verify services
  - [ ] Step 4.3: Verify Redis connection
  - [ ] Step 4.4: Test crawl functionality
  - [ ] Step 4.5: Verify resumability
- [ ] Phase 5: Cleanup
  - [ ] Step 5.1: Remove redis-queue-data volume
  - [ ] Step 5.2: Verify no zombie containers
