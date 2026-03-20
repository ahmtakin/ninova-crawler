/**
 * Back pressure mechanisms for the crawler:
 * 1. Token Bucket Rate Limiter — controls requests per second
 * 2. Queue Depth Monitor — pauses when queue grows too large
 */

const logger = require('../utils/logger');

/**
 * Token bucket rate limiter.
 * Allows bursting up to maxTokens, refills at a steady rate.
 */
class RateLimiter {
  /**
   * @param {number} maxTokensPerSecond - Maximum requests per second
   */
  constructor(maxTokensPerSecond) {
    this.maxTokens = maxTokensPerSecond;
    this.tokens = maxTokensPerSecond;
    this.refillRate = maxTokensPerSecond; // tokens per second
    this.lastRefill = Date.now();
  }

  /**
   * Acquire a token. Resolves when a token becomes available.
   * If no tokens, waits until refill.
   * @returns {Promise<void>}
   */
  async acquire() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // seconds

    // Refill tokens based on elapsed time
    this.tokens += elapsed * this.refillRate;
    if (this.tokens > this.maxTokens) {
      this.tokens = this.maxTokens;
    }
    this.lastRefill = now;

    // If we have a token, consume it
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // No tokens available - calculate wait time until next refill
    const tokensNeeded = 1 - this.tokens;
    const waitTime = (tokensNeeded / this.refillRate) * 1000; // ms

    await new Promise(resolve => setTimeout(resolve, waitTime));

    // Refill and consume after waiting
    this.lastRefill = Date.now();
    this.tokens = this.maxTokens - 1;
  }

  /**
   * Get current rate limiter status.
   */
  getStatus() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens += elapsed * this.refillRate;
    if (this.tokens > this.maxTokens) {
      this.tokens = this.maxTokens;
    }
    this.lastRefill = now;

    return {
      availableTokens: Math.max(0, Math.floor(this.tokens)),
      maxTokens: this.maxTokens,
      isThrottled: this.tokens < 1
    };
  }
}

/**
 * Queue depth monitor — tracks whether the URL queue is too deep.
 */
class QueueDepthMonitor {
  /**
   * @param {number} maxDepth - Maximum allowed queue depth
   */
  constructor(maxDepth) {
    this.maxDepth = maxDepth;
  }

  /**
   * Check queue depth status.
   * @param {number} currentDepth
   * @returns {{ isOverLimit: boolean, currentDepth: number, maxDepth: number, utilizationPercent: number }}
   */
  check(currentDepth) {
    const utilizationPercent = Math.min(100, (currentDepth / this.maxDepth) * 100);
    return {
      isOverLimit: currentDepth >= this.maxDepth,
      currentDepth,
      maxDepth: this.maxDepth,
      utilizationPercent: Math.round(utilizationPercent * 100) / 100
    };
  }

  /**
   * Should the crawler pause adding new URLs?
   * @param {number} currentDepth
   * @returns {boolean}
   */
  shouldPause(currentDepth) {
    return currentDepth >= this.maxDepth;
  }
}

module.exports = { RateLimiter, QueueDepthMonitor };
