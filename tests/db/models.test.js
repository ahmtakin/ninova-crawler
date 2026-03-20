const assert = require('node:assert/strict');
const { COLLECTIONS } = require('../../src/db/models');
const test = require('node:test');

test('COLLECTIONS should export CRAWL_LOGS constant', () => {
  assert.strictEqual(COLLECTIONS.CRAWL_LOGS, 'crawl_logs');
});
