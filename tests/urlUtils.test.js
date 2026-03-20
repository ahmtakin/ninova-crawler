/**
 * Tests for URL normalization and validation.
 * Run: node --test tests/urlUtils.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeUrl, isValidUrl, isSameDomain } = require('../src/utils/urlUtils.js');

describe('normalizeUrl', () => {
  it('should strip fragments', () => {
    assert.strictEqual(normalizeUrl('https://example.com/page#section'), 'https://example.com/page');
  });

  it('should remove trailing slash', () => {
    assert.strictEqual(normalizeUrl('https://example.com/page/'), 'https://example.com/page');
  });

  it('should keep root slash', () => {
    assert.strictEqual(normalizeUrl('https://example.com/'), 'https://example.com');
  });

  it('should lowercase hostname', () => {
    assert.strictEqual(normalizeUrl('https://EXAMPLE.COM/Page'), 'https://example.com/Page');
  });

  it('should resolve relative URLs', () => {
    assert.strictEqual(normalizeUrl('/about', 'https://example.com/page'), 'https://example.com/about');
    assert.strictEqual(normalizeUrl('next', 'https://example.com/dir/'), 'https://example.com/dir/next');
  });

  it('should return null for non-http protocols', () => {
    assert.strictEqual(normalizeUrl('ftp://example.com'), null);
    assert.strictEqual(normalizeUrl('javascript:void(0)'), null);
    assert.strictEqual(normalizeUrl('mailto:test@test.com'), null);
  });

  it('should sort query parameters', () => {
    assert.strictEqual(normalizeUrl('https://example.com?b=2&a=1'), 'https://example.com?a=1&b=2');
  });
});

describe('isValidUrl', () => {
  it('should accept http and https', () => {
    assert.ok(isValidUrl('https://example.com'));
    assert.ok(isValidUrl('http://example.com'));
  });

  it('should reject invalid URLs', () => {
    assert.ok(!isValidUrl('not-a-url'));
    assert.ok(!isValidUrl('ftp://files.com'));
    assert.ok(!isValidUrl(''));
  });
});

describe('isSameDomain', () => {
  it('should match same domains', () => {
    assert.ok(isSameDomain('https://example.com/a', 'https://example.com/b'));
  });

  it('should not match different domains', () => {
    assert.ok(!isSameDomain('https://example.com', 'https://other.com'));
  });

  it('should treat subdomains as different', () => {
    assert.ok(!isSameDomain('https://www.example.com', 'https://api.example.com'));
  });
});
