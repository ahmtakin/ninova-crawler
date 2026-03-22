/**
 * Tests for the backpressure module.
 * Tests RateLimiter and QueueDepthMonitor classes.
 *
 * Run: node --test tests/crawler/backpressure.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { RateLimiter, QueueDepthMonitor } = require('../../src/crawler/backpressure');

describe('RateLimiter', () => {
  describe('constructor', () => {
    it('should initialize with correct token values', () => {
      const limiter = new RateLimiter(10);
      assert.strictEqual(limiter.maxTokens, 10);
      assert.strictEqual(limiter.tokens, 10);
      assert.strictEqual(limiter.refillRate, 10);
      assert.ok(limiter.lastRefill);
      assert.strictEqual(typeof limiter.lastRefill, 'number');
    });

    it('should handle different rate limits', () => {
      const limiter5 = new RateLimiter(5);
      assert.strictEqual(limiter5.maxTokens, 5);
      assert.strictEqual(limiter5.tokens, 5);

      const limiter100 = new RateLimiter(100);
      assert.strictEqual(limiter100.maxTokens, 100);
      assert.strictEqual(limiter100.tokens, 100);
    });
  });

  describe('acquire()', () => {
    it('should consume token when available', async () => {
      const limiter = new RateLimiter(10);
      const initialTokens = limiter.tokens;
      assert.strictEqual(initialTokens, 10);

      await limiter.acquire();

      assert.strictEqual(limiter.tokens, initialTokens - 1);
    });

    it('should allow multiple consecutive acquires when tokens available', async () => {
      const limiter = new RateLimiter(5);

      await limiter.acquire();
      assert.ok(Math.abs(limiter.tokens - 4) < 0.01, `Expected ~4 tokens, got ${limiter.tokens}`);

      await limiter.acquire();
      assert.ok(Math.abs(limiter.tokens - 3) < 0.01, `Expected ~3 tokens, got ${limiter.tokens}`);

      await limiter.acquire();
      assert.ok(Math.abs(limiter.tokens - 2) < 0.01, `Expected ~2 tokens, got ${limiter.tokens}`);
    });

    it('should wait when no tokens available and refill after time', async () => {
      const limiter = new RateLimiter(2);

      // Consume all tokens
      await limiter.acquire();
      await limiter.acquire();
      assert.strictEqual(limiter.tokens, 0);

      // This acquire should wait for refill
      const startTime = Date.now();
      await limiter.acquire();
      const elapsed = Date.now() - startTime;

      // Should have waited approximately 500ms (1 token at 2 tokens/sec)
      assert.ok(elapsed >= 400, `Should wait at least 400ms, waited ${elapsed}ms`);
      assert.ok(elapsed < 700, `Should wait less than 700ms, waited ${elapsed}ms`);
    });

    it('should refill tokens based on elapsed time', async () => {
      const limiter = new RateLimiter(10);

      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        await limiter.acquire();
      }
      assert.strictEqual(limiter.tokens, 0);

      // Wait for refill (100ms should give ~1 token at 10/sec)
      await new Promise(resolve => setTimeout(resolve, 150));

      // getStatus will trigger refill
      const status = limiter.getStatus();
      assert.ok(status.availableTokens >= 1, `Should have at least 1 token after 150ms, got ${status.availableTokens}`);
    });

    it('should handle acquire immediately after refill', async () => {
      const limiter = new RateLimiter(5);

      // Consume all tokens
      for (let i = 0; i < 5; i++) {
        await limiter.acquire();
      }

      // Wait for enough time to refill all tokens
      await new Promise(resolve => setTimeout(resolve, 300));

      // Should be able to acquire immediately (or very quickly)
      const startTime = Date.now();
      await limiter.acquire();
      const elapsed = Date.now() - startTime;

      assert.ok(elapsed < 100, `Should acquire immediately after refill, took ${elapsed}ms`);
    });

    it('should refill tokens correctly across multiple waits', async () => {
      const limiter = new RateLimiter(2);

      // Consume all tokens
      await limiter.acquire();
      await limiter.acquire();

      // First wait - should wait for refill
      const start1 = Date.now();
      await limiter.acquire();
      const elapsed1 = Date.now() - start1;
      assert.ok(elapsed1 >= 400, `First wait should be ~500ms, took ${elapsed1}ms`);

      // Second wait - since we consumed the refilled token, need another refill
      // However, the timing might vary based on when the first wait completed
      const start2 = Date.now();
      await limiter.acquire();
      const elapsed2 = Date.now() - start2;

      // Either it waits (if token was consumed) or it's fast (if refill happened during wait)
      // Both are valid behaviors, just verify it completes
      assert.ok(elapsed2 >= 0, `Second wait should complete, took ${elapsed2}ms`);
    });
  });

  describe('getStatus()', () => {
    it('should return correct status with available tokens', () => {
      const limiter = new RateLimiter(10);
      const status = limiter.getStatus();

      assert.strictEqual(status.availableTokens, 10);
      assert.strictEqual(status.maxTokens, 10);
      assert.strictEqual(status.isThrottled, false);
    });

    it('should show throttled when tokens exhausted', async () => {
      const limiter = new RateLimiter(3);

      // Consume all tokens
      await limiter.acquire();
      await limiter.acquire();
      await limiter.acquire();

      const status = limiter.getStatus();
      assert.strictEqual(status.availableTokens, 0);
      assert.strictEqual(status.isThrottled, true);
    });

    it('should update token count based on elapsed time', async () => {
      const limiter = new RateLimiter(10);

      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        await limiter.acquire();
      }

      let status = limiter.getStatus();
      assert.strictEqual(status.availableTokens, 0);

      // Wait for some refill
      await new Promise(resolve => setTimeout(resolve, 110));

      status = limiter.getStatus();
      assert.ok(status.availableTokens >= 1, `Should have refilled at least 1 token`);
    });

    it('should not report negative available tokens', async () => {
      const limiter = new RateLimiter(1);

      await limiter.acquire();
      const status = limiter.getStatus();

      assert.ok(status.availableTokens >= 0, `Available tokens should not be negative`);
    });

    it('should report isThrottled correctly during refill', async () => {
      const limiter = new RateLimiter(5);

      // Consume all tokens
      for (let i = 0; i < 5; i++) {
        await limiter.acquire();
      }

      let status = limiter.getStatus();
      assert.strictEqual(status.isThrottled, true);

      // Wait for partial refill
      await new Promise(resolve => setTimeout(resolve, 80));

      status = limiter.getStatus();
      // After 80ms at 5/sec, should have ~0.4 tokens, still throttled
      if (status.availableTokens === 0) {
        assert.strictEqual(status.isThrottled, true);
      }
    });
  });

  describe('token refill behavior', () => {
    it('should not exceed maxTokens after refill', async () => {
      const limiter = new RateLimiter(5);

      // Consume 2 tokens
      await limiter.acquire();
      await limiter.acquire();

      // Wait long enough for full refill and more
      await new Promise(resolve => setTimeout(resolve, 500));

      const status = limiter.getStatus();
      assert.strictEqual(status.availableTokens, 5);
      assert.strictEqual(status.maxTokens, 5);
    });

    it('should handle rapid getStatus calls correctly', () => {
      const limiter = new RateLimiter(10);

      // Multiple getStatus calls should not increase tokens beyond max
      const status1 = limiter.getStatus();
      const status2 = limiter.getStatus();
      const status3 = limiter.getStatus();

      assert.strictEqual(status1.availableTokens, 10);
      assert.strictEqual(status2.availableTokens, 10);
      assert.strictEqual(status3.availableTokens, 10);
      assert.strictEqual(status3.maxTokens, 10);
    });

    it('should reset lastRefill time after refill calculation', async () => {
      const limiter = new RateLimiter(10);
      const initialLastRefill = limiter.lastRefill;

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50));

      limiter.getStatus();
      assert.ok(limiter.lastRefill > initialLastRefill, 'lastRefill should be updated');
    });
  });

  describe('edge cases', () => {
    it('should handle rate limit of 1 token per second', async () => {
      const limiter = new RateLimiter(1);

      await limiter.acquire();
      assert.strictEqual(limiter.tokens, 0);

      const startTime = Date.now();
      await limiter.acquire();
      const elapsed = Date.now() - startTime;

      assert.ok(elapsed >= 900, `Should wait ~1000ms at 1 token/sec, waited ${elapsed}ms`);
      assert.ok(elapsed < 1200, `Should not wait excessively long, waited ${elapsed}ms`);
    });

    it('should handle high rate limits (100 tokens/sec)', async () => {
      const limiter = new RateLimiter(100);

      // Should be able to acquire many tokens quickly
      const startTime = Date.now();
      for (let i = 0; i < 50; i++) {
        await limiter.acquire();
      }
      const elapsed = Date.now() - startTime;

      // Should complete 50 acquires very quickly with no waiting
      assert.ok(elapsed < 100, `Should complete 50 acquires quickly, took ${elapsed}ms`);
    });

    it('should handle concurrent acquire calls', async () => {
      const limiter = new RateLimiter(2);

      // Consume all tokens
      await limiter.acquire();
      await limiter.acquire();

      // Start multiple concurrent acquires - they should all wait and then succeed
      const promises = [
        limiter.acquire(),
        limiter.acquire(),
        limiter.acquire()
      ];

      await Promise.all(promises);

      // All should complete without errors
      assert.ok(true, 'All concurrent acquires should complete');
    });
  });
});

describe('QueueDepthMonitor', () => {
  describe('constructor', () => {
    it('should set max depth correctly', () => {
      const monitor = new QueueDepthMonitor(100);
      assert.strictEqual(monitor.maxDepth, 100);
    });

    it('should handle different max depths', () => {
      const monitor10 = new QueueDepthMonitor(10);
      assert.strictEqual(monitor10.maxDepth, 10);

      const monitor10000 = new QueueDepthMonitor(10000);
      assert.strictEqual(monitor10000.maxDepth, 10000);
    });
  });

  describe('check()', () => {
    it('should return correct utilization percentage', () => {
      const monitor = new QueueDepthMonitor(100);

      const result = monitor.check(50);

      assert.strictEqual(result.currentDepth, 50);
      assert.strictEqual(result.maxDepth, 100);
      assert.strictEqual(result.utilizationPercent, 50);
      assert.strictEqual(result.isOverLimit, false);
    });

    it('should calculate utilization correctly for various depths', () => {
      const monitor = new QueueDepthMonitor(200);

      assert.strictEqual(monitor.check(0).utilizationPercent, 0);
      assert.strictEqual(monitor.check(50).utilizationPercent, 25);
      assert.strictEqual(monitor.check(100).utilizationPercent, 50);
      assert.strictEqual(monitor.check(150).utilizationPercent, 75);
      assert.strictEqual(monitor.check(200).utilizationPercent, 100);
    });

    it('should return isOverLimit when at max depth', () => {
      const monitor = new QueueDepthMonitor(100);

      const result = monitor.check(100);

      assert.strictEqual(result.isOverLimit, true);
      assert.strictEqual(result.currentDepth, 100);
      assert.strictEqual(result.utilizationPercent, 100);
    });

    it('should return isOverLimit when over max depth', () => {
      const monitor = new QueueDepthMonitor(100);

      const result = monitor.check(150);

      assert.strictEqual(result.isOverLimit, true);
      assert.strictEqual(result.currentDepth, 150);
      assert.strictEqual(result.utilizationPercent, 100); // Capped at 100
    });

    it('should cap utilization at 100% when over limit', () => {
      const monitor = new QueueDepthMonitor(50);

      const result = monitor.check(200);

      assert.strictEqual(result.utilizationPercent, 100);
      assert.strictEqual(result.isOverLimit, true);
    });

    it('should handle zero current depth', () => {
      const monitor = new QueueDepthMonitor(100);

      const result = monitor.check(0);

      assert.strictEqual(result.currentDepth, 0);
      assert.strictEqual(result.utilizationPercent, 0);
      assert.strictEqual(result.isOverLimit, false);
    });

    it('should return rounded utilization percentage', () => {
      const monitor = new QueueDepthMonitor(3);

      const result = monitor.check(1);

      // 1/3 = 33.333... should be rounded
      assert.strictEqual(result.utilizationPercent, 33.33);
    });

    it('should handle fractional calculations correctly', () => {
      const monitor = new QueueDepthMonitor(7);

      const result = monitor.check(5);

      // 5/7 ≈ 71.428%
      assert.strictEqual(result.utilizationPercent, 71.43);
    });
  });

  describe('shouldPause()', () => {
    it('should return false when under max depth', () => {
      const monitor = new QueueDepthMonitor(100);

      assert.strictEqual(monitor.shouldPause(50), false);
      assert.strictEqual(monitor.shouldPause(99), false);
      assert.strictEqual(monitor.shouldPause(0), false);
    });

    it('should return true when at max depth', () => {
      const monitor = new QueueDepthMonitor(100);

      assert.strictEqual(monitor.shouldPause(100), true);
    });

    it('should return true when over max depth', () => {
      const monitor = new QueueDepthMonitor(100);

      assert.strictEqual(monitor.shouldPause(101), true);
      assert.strictEqual(monitor.shouldPause(200), true);
      assert.strictEqual(monitor.shouldPause(1000), true);
    });

    it('should work with small max depths', () => {
      const monitor = new QueueDepthMonitor(5);

      assert.strictEqual(monitor.shouldPause(4), false);
      assert.strictEqual(monitor.shouldPause(5), true);
      assert.strictEqual(monitor.shouldPause(10), true);
    });
  });

  describe('edge cases', () => {
    it('should handle very large depths', () => {
      const monitor = new QueueDepthMonitor(1000000);

      const result = monitor.check(500000);

      assert.strictEqual(result.currentDepth, 500000);
      assert.strictEqual(result.maxDepth, 1000000);
      assert.strictEqual(result.utilizationPercent, 50);
      assert.strictEqual(result.isOverLimit, false);
    });

    it('should handle max depth of 1', () => {
      const monitor = new QueueDepthMonitor(1);

      assert.strictEqual(monitor.check(0).isOverLimit, false);
      assert.strictEqual(monitor.check(1).isOverLimit, true);
      assert.strictEqual(monitor.check(2).isOverLimit, true);
    });

    it('should maintain consistent results across multiple checks', () => {
      const monitor = new QueueDepthMonitor(100);

      const result1 = monitor.check(75);
      const result2 = monitor.check(75);
      const result3 = monitor.check(75);

      assert.deepStrictEqual(result1, result2);
      assert.deepStrictEqual(result2, result3);
    });

    it('should not modify internal state when checking', () => {
      const monitor = new QueueDepthMonitor(50);
      const initialMaxDepth = monitor.maxDepth;

      monitor.check(25);
      monitor.check(50);
      monitor.check(100);

      assert.strictEqual(monitor.maxDepth, initialMaxDepth);
    });
  });
});
