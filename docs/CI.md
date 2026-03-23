# Continuous Integration

## Overview

This project uses GitHub Actions for continuous integration. Tests run automatically on every push and pull request to main/master/develop branches.

## Workflow Details

**File:** `.github/workflows/ci.yml`

**Triggers:**
- Push to `main`, `master`, or `develop` branches
- Pull requests targeting `main`, `master`, or `develop` branches
- Manual trigger via GitHub Actions UI (workflow_dispatch)

**Job:** `test` - Runs the full test suite

### Services

The CI workflow spins up the following service containers:

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| MongoDB | `mongo:7` | 27017 | Database for testing |
| Redis | `redis:7-alpine` | 6379 | Cache for testing |

**Note:** GitHub Actions automatically waits for services to become healthy before running tests. Health checks use:
- MongoDB: `mongosh --eval '1'` (simple connection test)
- Redis: `redis-cli ping` (PING/PONG response)

### Environment Variables

The following environment variables are set for the CI environment:

```bash
MONGO_URI=mongodb://localhost:27017/ninova
REDIS_CACHE_URL=redis://localhost:6379
NODE_ENV=test
```

### Test Execution

The workflow runs:
1. `npm ci` - Clean install of dependencies (faster, reproducible)
2. `npm run lint` - Linting (if configured, optional)
3. `npm test` - Full test suite

**Note:** `npm ci` is used instead of `npm install` for CI environments. It reads `package-lock.json` directly, ensuring reproducible installs and faster execution.

### Concurrency

Workflow runs use concurrency control:
- Group: `CI-{branch-ref}` (one group per branch)
- `cancel-in-progress: true` - New commits cancel outdated runs

This means:
- Pushes to the same branch cancel previous runs
- Different branches run concurrently
- PR runs are independent of branch pushes

### Caching

Node.js dependencies are cached using `cache: 'npm'`. This speeds up subsequent workflow runs by:
- Caching `node_modules` directory
- Caching npm cache directory
- Invalidating cache when `package-lock.json` changes

## Status Badge

Add a status badge to your README.md:

```markdown
[![CI](https://github.com/<username>/ninova-crawler/actions/workflows/ci.yml/badge.svg)](https://github.com/<username>/ninova-crawler/actions/workflows/ci.yml)
```

Replace `<username>` with your GitHub username.

The badge shows:
- Green (passing) when all tests pass
- Red (failing) when tests fail
- Yellow (in progress) when workflow is running

## Local Testing

To replicate CI environment locally:

```bash
# Start services
docker-compose up -d mongo redis-cache

# Run tests with same environment variables
MONGO_URI=mongodb://localhost:27017/ninova \
REDIS_CACHE_URL=redis://localhost:6379 \
NODE_ENV=test \
npm test

# Stop services
docker-compose down
```

## Troubleshooting

### Services Not Starting

**Symptoms:** Workflow fails at service startup phase

**Solutions:**
1. Check service health check command in workflow logs
2. Verify health check command syntax (`mongosh --eval '1'` for MongoDB)
3. Increase health check retries (default: 5 retries × 10s interval = 50s max)
4. Check service image versions in `.github/workflows/ci.yml`

### Tests Failing in CI but Passing Locally

**Common causes:**

1. **Node version mismatch**
   - CI uses Node.js 20.x (latest 20.x release)
   - Check local version: `node --version`
   - Solution: Ensure local Node.js is 20.x or test with `nvm use 20`

2. **Environment differences**
   - CI uses different MongoDB/Redis connection strings
   - Solution: Match CI environment variables locally

3. **Race conditions**
   - CI runs may be slower or faster than local
   - Solution: Add proper test isolation and timing waits

4. **Platform differences**
   - CI runs on Linux (ubuntu-latest)
   - Solution: Test locally on Linux or use Docker

5. **Service startup timing**
   - Services may take longer to be ready on first run
   - Solution: GitHub Actions health checks handle this automatically

### Workflow Not Triggering

**Checklist:**
1. Branch names match trigger conditions (`main`, `master`, `develop`)
2. Workflow file is in the correct location: `.github/workflows/ci.yml`
3. Workflow file is committed to the repository
4. GitHub Actions is enabled for the repository (Settings → Actions → Enable)

### Common GitHub Actions Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "No space left on device" | Runner disk full | Check artifact sizes, reduce retention |
| "Service container failed to start" | Image pull or startup failure | Verify image name, check Docker Hub status |
| "Timeout waiting for service" | Service not becoming healthy | Increase health-retries or health-interval |
| "Module not found" | Dependency not installed | Check package.json, run `npm ci` locally |
| "Port already in use" | Port conflict | Verify service ports are unique |

### Debug Failed Runs

1. **Download artifacts:** Failed runs upload test results (if available)
2. **Expand logs:** Click "Run tests" step to see full output
3. **Re-run workflow:** Use "Re-run failed jobs" button in Actions UI
4. **Use workflow_dispatch:** Manually trigger workflow from Actions UI for testing

## Node Version Strategy

The CI workflow uses `node-version: '20'` which installs the latest Node.js 20.x release. This provides:

**Pros:**
- Automatic security updates within 20.x series
- Latest features and bug fixes
- Matches project requirement (Node.js >=20.0.0)

**Cons:**
- Potential for unexpected breaking changes between 20.x releases
- Less reproducible than pinning exact version

**To pin exact version:** Change `node-version: '20'` to `node-version: '20.11.1'` (or specific version).
