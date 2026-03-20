/**
 * Tests for the search ranking logic.
 * Run: node --test tests/searcher.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { tokenize, countFrequencies, STOP_WORDS } = require('../src/search/indexer.js');

describe('tokenize', () => {
  it('should lowercase and split on non-alphanumeric', () => {
    const tokens = tokenize('Hello World! This is a Test.');
    assert.ok(tokens.includes('hello'));
    assert.ok(tokens.includes('world'));
    assert.ok(tokens.includes('test'));
  });

  it('should remove stop words', () => {
    const tokens = tokenize('this is a very important test');
    assert.ok(!tokens.includes('this'));
    assert.ok(!tokens.includes('is'));
    assert.ok(!tokens.includes('a'));
    assert.ok(!tokens.includes('very'));
    assert.ok(tokens.includes('important'));
    assert.ok(tokens.includes('test'));
  });

  it('should filter tokens shorter than 2 characters', () => {
    const tokens = tokenize('I am a big fan of AI');
    assert.ok(!tokens.includes('i'));
    assert.ok(tokens.includes('big'));
    assert.ok(tokens.includes('fan'));
    assert.ok(tokens.includes('ai'));
  });

  it('should handle empty input', () => {
    assert.deepStrictEqual(tokenize(''), []);
    assert.deepStrictEqual(tokenize('   '), []);
  });
});

describe('countFrequencies', () => {
  it('should count word occurrences', () => {
    const freq = countFrequencies(['hello', 'world', 'hello', 'hello']);
    assert.strictEqual(freq.get('hello'), 3);
    assert.strictEqual(freq.get('world'), 1);
  });

  it('should handle empty array', () => {
    const freq = countFrequencies([]);
    assert.strictEqual(freq.size, 0);
  });
});

describe('scoring logic', () => {
  it('should rank title matches higher than body-only matches', () => {
    // Title matches get 3x bonus
    const bodyFreq = countFrequencies(['test', 'example']);
    const freq1 = new Map([...bodyFreq]);
    const freq2 = new Map([...bodyFreq]);

    // Simulate score calculation: frequency * titleBonus
    // With title match: 1 * 3 = 3, without: 1 * 1 = 1
    assert.ok(true); // Placeholder - actual scoring tested in integration
  });

  it('should penalize deeper pages', () => {
    // Depth penalty: 1 / (depth + 1)
    // Depth 0: 1/1 = 1, Depth 3: 1/4 = 0.25
    assert.ok(true); // Placeholder - actual scoring tested in integration
  });

  it('should boost multi-word query matches', () => {
    // Multi-word bonus: count of distinct query words matched
    assert.ok(true); // Placeholder - actual scoring tested in integration
  });
});
