/**
 * Logger Utility Tests
 *
 * Tests the structured JSON logger with timestamps and levels.
 * Run: node --test tests/utils/logger.test.js
 */

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

describe('Logger Utility', () => {
  let logger;
  let consoleLogCalls;
  let consoleErrorCalls;
  let originalConsoleLog;
  let originalConsoleError;

  beforeEach(() => {
    // Clear require cache to reset logger state
    delete require.cache[require.resolve('../../src/utils/logger')];

    // Store original console methods
    originalConsoleLog = console.log;
    originalConsoleError = console.error;

    // Track console calls
    consoleLogCalls = [];
    consoleErrorCalls = [];

    // Mock console methods
    console.log = (...args) => consoleLogCalls.push(args);
    console.error = (...args) => consoleErrorCalls.push(args);

    // Load logger after mocking
    logger = require('../../src/utils/logger');
  });

  afterEach(() => {
    // Restore original console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe('log levels', () => {
    it('should log info messages', () => {
      logger.info('Test message');

      assert.strictEqual(consoleLogCalls.length, 1);
      assert.strictEqual(consoleErrorCalls.length, 0);
    });

    it('should log warn messages', () => {
      logger.warn('Warning message');

      assert.strictEqual(consoleLogCalls.length, 1);
      assert.strictEqual(consoleErrorCalls.length, 0);
    });

    it('should log error messages to stderr', () => {
      logger.error('Error message');

      assert.strictEqual(consoleLogCalls.length, 0);
      assert.strictEqual(consoleErrorCalls.length, 1);
    });

    it('should respect LOG_LEVEL environment variable', () => {
      // Reset logger with warn level
      process.env.LOG_LEVEL = 'warn';
      delete require.cache[require.resolve('../../src/utils/logger')];
      const warnLogger = require('../../src/utils/logger');

      warnLogger.debug('Debug message');
      warnLogger.info('Info message');
      warnLogger.warn('Warn message');
      warnLogger.error('Error message');

      // debug and info should be filtered out
      assert.strictEqual(consoleLogCalls.length, 1); // Only warn
      assert.strictEqual(consoleErrorCalls.length, 1); // Only error

      // Clean up
      delete process.env.LOG_LEVEL;
    });

    it('should not log debug when level is info (default)', () => {
      logger.debug('Debug message');

      assert.strictEqual(consoleLogCalls.length, 0);
      assert.strictEqual(consoleErrorCalls.length, 0);
    });

    it('should log all levels when LOG_LEVEL is debug', () => {
      process.env.LOG_LEVEL = 'debug';
      delete require.cache[require.resolve('../../src/utils/logger')];
      const debugLogger = require('../../src/utils/logger');

      debugLogger.debug('Debug message');
      debugLogger.info('Info message');
      debugLogger.warn('Warn message');
      debugLogger.error('Error message');

      assert.strictEqual(consoleLogCalls.length, 3); // debug + info + warn (to stdout)
      assert.strictEqual(consoleErrorCalls.length, 1); // error (to stderr)

      // Clean up
      delete process.env.LOG_LEVEL;
    });
  });

  describe('log structure', () => {
    it('should include timestamp in ISO format', () => {
      logger.info('Test message');

      const logEntry = JSON.parse(consoleLogCalls[0][0]);
      assert.ok(logEntry.timestamp);
      assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(logEntry.timestamp));
    });

    it('should include log level', () => {
      logger.info('Test message');

      const logEntry = JSON.parse(consoleLogCalls[0][0]);
      assert.strictEqual(logEntry.level, 'info');
    });

    it('should include message', () => {
      logger.info('Test message');

      const logEntry = JSON.parse(consoleLogCalls[0][0]);
      assert.strictEqual(logEntry.message, 'Test message');
    });

    it('should include metadata/data when provided', () => {
      const metadata = { url: 'https://example.com', statusCode: 200 };
      logger.info('Request completed', metadata);

      const logEntry = JSON.parse(consoleLogCalls[0][0]);
      assert.strictEqual(logEntry.url, 'https://example.com');
      assert.strictEqual(logEntry.statusCode, 200);
    });

    it('should handle complex nested metadata', () => {
      const metadata = {
        job: { id: '123', origin: 'https://example.com' },
        stats: { pages: 10, errors: 0 }
      };
      logger.info('Job progress', metadata);

      const logEntry = JSON.parse(consoleLogCalls[0][0]);
      assert.strictEqual(logEntry.job.id, '123');
      assert.strictEqual(logEntry.job.origin, 'https://example.com');
      assert.strictEqual(logEntry.stats.pages, 10);
    });

    it('should output valid JSON', () => {
      logger.info('Test message', { key: 'value' });

      const logString = consoleLogCalls[0][0];
      assert.doesNotThrow(() => JSON.parse(logString));
    });

    it('should handle special characters in message', () => {
      logger.info('Message with "quotes" and \'apostrophes\'');

      const logEntry = JSON.parse(consoleLogCalls[0][0]);
      assert.strictEqual(logEntry.message, 'Message with "quotes" and \'apostrophes\'');
    });

    it('should handle empty data object', () => {
      logger.info('Test message', {});

      const logEntry = JSON.parse(consoleLogCalls[0][0]);
      assert.strictEqual(logEntry.message, 'Test message');
      assert.strictEqual(logEntry.level, 'info');
    });

    it('should handle null and undefined data values', () => {
      logger.info('Test message', { nullValue: null, undefinedValue: undefined });

      const logEntry = JSON.parse(consoleLogCalls[0][0]);
      assert.strictEqual(logEntry.nullValue, null);
      // undefined becomes undefined in JSON which is omitted
      assert.strictEqual(logEntry.undefinedValue, undefined);
    });
  });

  describe('error level specifics', () => {
    it('should include error details in error logs', () => {
      const error = new Error('Something went wrong');
      logger.error('Operation failed', { error: error.message, code: 'ERR_001' });

      const logEntry = JSON.parse(consoleErrorCalls[0][0]);
      assert.strictEqual(logEntry.level, 'error');
      assert.strictEqual(logEntry.message, 'Operation failed');
      assert.strictEqual(logEntry.error, 'Something went wrong');
      assert.strictEqual(logEntry.code, 'ERR_001');
    });

    it('should output errors to console.error', () => {
      logger.error('Error occurred');

      assert.strictEqual(consoleErrorCalls.length, 1);
      assert.strictEqual(consoleLogCalls.length, 0);
    });
  });

  describe('edge cases', () => {
    it('should throw on circular references (JSON.stringify limitation)', () => {
      const circular = { name: 'test' };
      circular.self = circular;

      // JSON.stringify cannot handle circular references
      assert.throws(() => {
        logger.info('Circular reference test', { data: circular });
      }, /Converting circular structure to JSON/);
    });

    it('should handle very long messages', () => {
      const longMessage = 'x'.repeat(10000);
      logger.info(longMessage);

      const logEntry = JSON.parse(consoleLogCalls[0][0]);
      assert.strictEqual(logEntry.message.length, 10000);
    });

    it('should handle unicode characters', () => {
      logger.info('Unicode test: 你好 🚀 Ñoño');

      const logEntry = JSON.parse(consoleLogCalls[0][0]);
      assert.ok(logEntry.message.includes('你好'));
      assert.ok(logEntry.message.includes('🚀'));
    });
  });
});
