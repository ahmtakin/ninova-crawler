/**
 * Comprehensive tests for the indexer module.
 * Tests tokenization, frequency counting, and page indexing functionality.
 *
 * Run: node --test tests/search/indexer.test.js
 */

const { describe, it, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

// Import only the functions that don't need database mocking
const { tokenize, countFrequencies, STOP_WORDS } = require('../../src/search/indexer');
const { setupTestDb, cleanupTestDb, closeTestDb, FIXTURES } = require('../setup');
const { COLLECTIONS } = require('../../src/db/models');

describe('indexer module', function() {
  // Set timeout for database operations
  this.timeout = 10000;

  let db;
  let crawlJobId;
  let indexPage;
  let getDbMock;

  before(async () => {
    // Set up test database first
    db = await setupTestDb();
    crawlJobId = new ObjectId();

    // Mock getDb in the mongo module BEFORE importing indexer
    const mongoModule = require('../../src/db/mongo');
    const originalGetDb = mongoModule.getDb;

    // Create a mock that returns our test database
    getDbMock = mock.method(mongoModule, 'getDb', () => db);

    // Clear the require cache for indexer so it uses our mocked getDb
    delete require.cache[require.resolve('../../src/search/indexer')];

    // Now import indexPage which will use our mocked getDb
    const indexer = require('../../src/search/indexer');
    indexPage = indexer.indexPage;
  });

  after(async () => {
    getDbMock?.mock.restore();
    await closeTestDb();
  });

  describe('tokenize()', () => {
    it('should lowercase and split on non-alphanumeric characters', () => {
      const tokens = tokenize('Hello World! This is a Test.');
      assert.ok(tokens.includes('hello'));
      assert.ok(tokens.includes('world'));
      assert.ok(tokens.includes('test'));
      assert.ok(!tokens.includes('Hello'));
      assert.ok(!tokens.includes('World'));
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

    it('should handle null and undefined input', () => {
      assert.deepStrictEqual(tokenize(null), []);
      assert.deepStrictEqual(tokenize(undefined), []);
    });

    it('should handle non-string input', () => {
      assert.deepStrictEqual(tokenize(123), []);
      assert.deepStrictEqual(tokenize({}), []);
      assert.deepStrictEqual(tokenize([]), []);
    });

    it('should handle special characters and punctuation', () => {
      const tokens = tokenize('Hello, world! Testing parsing logic.');
      assert.ok(tokens.includes('hello'));
      assert.ok(tokens.includes('world'));
      assert.ok(tokens.includes('testing'));
      assert.ok(tokens.includes('parsing'));
      assert.ok(tokens.includes('logic'));
      assert.ok(!tokens.includes(','));
      assert.ok(!tokens.includes('!'));
      assert.ok(!tokens.includes('.'));
    });

    it('should handle numbers in text', () => {
      const tokens = tokenize('There are 123 items in 2024');
      assert.ok(tokens.includes('123'));
      assert.ok(tokens.includes('2024'));
      assert.ok(tokens.includes('items'));
    });

    it('should handle hyphenated words', () => {
      const tokens = tokenize('state-of-the-art technology');
      assert.ok(tokens.includes('state'));
      assert.ok(tokens.includes('art')); // 'of' and 'the' are stop words
      assert.ok(tokens.includes('technology'));
      assert.ok(!tokens.includes('of')); // stop word
      assert.ok(!tokens.includes('the')); // stop word
    });

    it('should handle multiple spaces and newlines', () => {
      const tokens = tokenize('hello    world\n\n  test');
      assert.ok(tokens.includes('hello'));
      assert.ok(tokens.includes('world'));
      assert.ok(tokens.includes('test'));
    });

    it('should handle URLs and email addresses', () => {
      const tokens = tokenize('Visit https://example.com or email test@example.com');
      assert.ok(tokens.includes('visit'));
      assert.ok(tokens.includes('https'));
      assert.ok(tokens.includes('example')); // URLs split by dots
      assert.ok(tokens.includes('com'));
      assert.ok(tokens.includes('email'));
      assert.ok(tokens.includes('test'));
    });

    it('should filter all common stop words', () => {
      const tokens = tokenize('the quick brown fox jumps over the lazy dog');
      assert.ok(tokens.includes('quick'));
      assert.ok(tokens.includes('brown'));
      assert.ok(tokens.includes('fox'));
      assert.ok(tokens.includes('jumps'));
      assert.ok(tokens.includes('lazy'));
      assert.ok(tokens.includes('dog'));
      assert.ok(!tokens.includes('the'));
      assert.ok(!tokens.includes('over'));
    });
  });

  describe('countFrequencies()', () => {
    it('should count word occurrences correctly', () => {
      const freq = countFrequencies(['hello', 'world', 'hello', 'hello']);
      assert.strictEqual(freq.get('hello'), 3);
      assert.strictEqual(freq.get('world'), 1);
    });

    it('should handle empty array', () => {
      const freq = countFrequencies([]);
      assert.strictEqual(freq.size, 0);
    });

    it('should handle single word', () => {
      const freq = countFrequencies(['test']);
      assert.strictEqual(freq.size, 1);
      assert.strictEqual(freq.get('test'), 1);
    });

    it('should handle multiple unique words', () => {
      const freq = countFrequencies(['one', 'two', 'three', 'four']);
      assert.strictEqual(freq.size, 4);
      assert.strictEqual(freq.get('one'), 1);
      assert.strictEqual(freq.get('two'), 1);
      assert.strictEqual(freq.get('three'), 1);
      assert.strictEqual(freq.get('four'), 1);
    });

    it('should handle case-sensitive input', () => {
      const freq = countFrequencies(['Hello', 'hello', 'HELLO']);
      assert.strictEqual(freq.size, 3);
      assert.strictEqual(freq.get('Hello'), 1);
      assert.strictEqual(freq.get('hello'), 1);
      assert.strictEqual(freq.get('HELLO'), 1);
    });

    it('should return a Map object', () => {
      const freq = countFrequencies(['test']);
      assert.ok(freq instanceof Map);
    });
  });

  describe('indexPage() - basic functionality', () => {
    beforeEach(async () => {
      await cleanupTestDb();
    });

    it('should create word index entries from page text', async () => {
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: 'Test Page',
        textContent: 'hello world test example'
      };

      // Create a page entry first
      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId,
        indexedAt: null
      });

      await indexPage(pageData);

      const wordIndex = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId })
        .toArray();

      assert.ok(wordIndex.length > 0, 'Should create word index entries');

      const words = wordIndex.map(entry => entry.word);
      assert.ok(words.includes('hello'), 'Should include "hello"');
      assert.ok(words.includes('world'), 'Should include "world"');
      assert.ok(words.includes('test'), 'Should include "test"');
      assert.ok(words.includes('example'), 'Should include "example"');
    });

    it('should create word index entries from page title', async () => {
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: 'crawling search engine',
        textContent: 'some content here'
      };

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId,
        indexedAt: null
      });

      await indexPage(pageData);

      const wordIndex = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId, url: pageData.url })
        .toArray();

      const crawlingEntry = wordIndex.find(e => e.word === 'crawling');
      const searchEntry = wordIndex.find(e => e.word === 'search');
      const engineEntry = wordIndex.find(e => e.word === 'engine');

      assert.ok(crawlingEntry, 'Should have entry for "crawling"');
      assert.ok(searchEntry, 'Should have entry for "search"');
      assert.ok(engineEntry, 'Should have entry for "engine"');

      assert.strictEqual(crawlingEntry.inTitle, true);
      assert.strictEqual(searchEntry.inTitle, true);
      assert.strictEqual(engineEntry.inTitle, true);
    });

    it('should set inTitle flag correctly for title words', async () => {
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: 'important keywords',
        textContent: 'content without keywords'
      };

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId,
        indexedAt: null
      });

      await indexPage(pageData);

      const wordIndex = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId, url: pageData.url })
        .toArray();

      const importantEntry = wordIndex.find(e => e.word === 'important');
      const keywordsEntry = wordIndex.find(e => e.word === 'keywords');
      const contentEntry = wordIndex.find(e => e.word === 'content');

      assert.ok(importantEntry, 'Should have entry for "important"');
      assert.strictEqual(importantEntry.inTitle, true, '"important" should be in title');
      assert.strictEqual(importantEntry.frequency, 0, '"important" should have frequency 0 (only in title)');

      assert.ok(keywordsEntry, 'Should have entry for "keywords"');
      assert.strictEqual(keywordsEntry.inTitle, true, '"keywords" should be in title');

      assert.ok(contentEntry, 'Should have entry for "content"');
      assert.strictEqual(contentEntry.inTitle, false, '"content" should not be in title');
    });

    it('should count word frequencies correctly', async () => {
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: 'Test',
        textContent: 'test test test example'
      };

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId,
        indexedAt: null
      });

      await indexPage(pageData);

      const wordIndex = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId, url: pageData.url })
        .toArray();

      const testEntry = wordIndex.find(e => e.word === 'test');
      assert.ok(testEntry, 'Should have entry for "test"');
      assert.strictEqual(testEntry.frequency, 3, '"test" should have frequency 3');
    });

    it('should handle empty page text', async () => {
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: 'Test Page',
        textContent: ''
      };

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId,
        indexedAt: null
      });

      await indexPage(pageData);

      const wordIndex = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId, url: pageData.url })
        .toArray();

      // Should still create entries for title words
      assert.ok(wordIndex.length > 0, 'Should create entries for title words');
    });

    it('should handle pages with no title', async () => {
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: '',
        textContent: 'some content here'
      };

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId,
        indexedAt: null
      });

      await indexPage(pageData);

      const wordIndex = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId, url: pageData.url })
        .toArray();

      assert.ok(wordIndex.length > 0, 'Should create entries for body text');

      // All entries should have inTitle: false
      wordIndex.forEach(entry => {
        assert.strictEqual(entry.inTitle, false, 'All entries should have inTitle: false');
      });
    });

    it('should upsert to database correctly', async () => {
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: 'Test',
        textContent: 'hello world'
      };

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId,
        indexedAt: null
      });

      // First index
      await indexPage(pageData);

      // Update and re-index
      pageData.textContent = 'hello world test';
      await indexPage(pageData);

      const wordIndex = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId, url: pageData.url })
        .toArray();

      // Should still have only unique entries (upsert)
      const helloEntries = wordIndex.filter(e => e.word === 'hello');
      assert.strictEqual(helloEntries.length, 1, 'Should have only one "hello" entry');
      assert.strictEqual(helloEntries[0].frequency, 1, '"hello" frequency should be updated');

      const testEntries = wordIndex.filter(e => e.word === 'test');
      assert.strictEqual(testEntries.length, 1, 'Should have only one "test" entry');
    });

    it('should update indexedAt timestamp', async () => {
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: 'Test',
        textContent: 'hello world'
      };

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId,
        indexedAt: null
      });

      await indexPage(pageData);

      const page = await db.collection(COLLECTIONS.PAGES).findOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId
      });

      assert.ok(page.indexedAt, 'indexedAt should be set');
      assert.ok(page.indexedAt instanceof Date, 'indexedAt should be a Date');
    });
  });

  describe('indexPage() - position field', () => {
    beforeEach(async () => {
      await cleanupTestDb();
    });

    it('should set position to "body" for words only in body', async () => {
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: 'Page Title',
        textContent: 'content example'
      };

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId,
        indexedAt: null
      });

      await indexPage(pageData);

      const wordIndex = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId, url: pageData.url })
        .toArray();

      const contentEntry = wordIndex.find(e => e.word === 'content');
      assert.ok(contentEntry, 'Should have entry for "content"');
      assert.strictEqual(contentEntry.position, 'body', 'Position should be "body"');
      assert.strictEqual(contentEntry.inTitle, false);
    });

    it('should set position to "title" for words only in title', async () => {
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: 'unique keywords',
        textContent: 'some other content'
      };

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId,
        indexedAt: null
      });

      await indexPage(pageData);

      const wordIndex = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId, url: pageData.url })
        .toArray();

      const uniqueEntry = wordIndex.find(e => e.word === 'unique');
      assert.ok(uniqueEntry, 'Should have entry for "unique"');
      assert.strictEqual(uniqueEntry.position, 'title', 'Position should be "title"');
      assert.strictEqual(uniqueEntry.inTitle, true);
      assert.strictEqual(uniqueEntry.frequency, 0, 'Frequency should be 0 for title-only words');
    });

    it('should set position to "both" for words in both title and body', async () => {
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: 'example page',
        textContent: 'this example demonstrates'
      };

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId,
        indexedAt: null
      });

      await indexPage(pageData);

      const wordIndex = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId, url: pageData.url })
        .toArray();

      const exampleEntry = wordIndex.find(e => e.word === 'example');
      assert.ok(exampleEntry, 'Should have entry for "example"');
      assert.strictEqual(exampleEntry.position, 'both', 'Position should be "both"');
      assert.strictEqual(exampleEntry.inTitle, true);
      assert.strictEqual(exampleEntry.frequency, 1, 'Frequency should count body occurrences');
    });

    it('should correctly handle words appearing multiple times in body and once in title', async () => {
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: 'test page',
        textContent: 'test test test content'
      };

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId,
        indexedAt: null
      });

      await indexPage(pageData);

      const wordIndex = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId, url: pageData.url, word: 'test' })
        .toArray();

      assert.strictEqual(wordIndex.length, 1, 'Should have only one "test" entry');
      const testEntry = wordIndex[0];
      assert.strictEqual(testEntry.position, 'both');
      assert.strictEqual(testEntry.frequency, 3, 'Frequency should be 3 (body count)');
      assert.strictEqual(testEntry.inTitle, true);
    });
  });

  describe('indexPage() - stop words filtering', () => {
    beforeEach(async () => {
      await cleanupTestDb();
    });

    it('should not index stop words from title', async () => {
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: 'the quick brown fox',
        textContent: 'some content'
      };

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId,
        indexedAt: null
      });

      await indexPage(pageData);

      const wordIndex = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId, url: pageData.url })
        .toArray();

      const words = wordIndex.map(e => e.word);
      assert.ok(!words.includes('the'), 'Should not include stop word "the"');
    });

    it('should not index stop words from body', async () => {
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: 'Test Page',
        textContent: 'this is a very simple test content'
      };

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId,
        indexedAt: null
      });

      await indexPage(pageData);

      const wordIndex = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId, url: pageData.url })
        .toArray();

      const words = wordIndex.map(e => e.word);
      assert.ok(!words.includes('this'), 'Should not include stop word "this"');
      assert.ok(!words.includes('is'), 'Should not include stop word "is"');
      assert.ok(!words.includes('a'), 'Should not include stop word "a"');
      assert.ok(!words.includes('very'), 'Should not include stop word "very"');
    });

    it('should index non-stop words correctly', async () => {
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: 'Test Page',
        textContent: 'machine learning algorithms are powerful'
      };

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId,
        indexedAt: null
      });

      await indexPage(pageData);

      const wordIndex = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId, url: pageData.url })
        .toArray();

      const words = wordIndex.map(e => e.word);
      assert.ok(words.includes('machine'), 'Should include "machine"');
      assert.ok(words.includes('learning'), 'Should include "learning"');
      assert.ok(words.includes('algorithms'), 'Should include "algorithms"');
      assert.ok(words.includes('powerful'), 'Should include "powerful"');
    });
  });

  describe('indexPage() - edge cases', () => {
    beforeEach(async () => {
      await cleanupTestDb();
    });

    it('should handle null title', async () => {
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: null,
        textContent: 'some content'
      };

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId,
        indexedAt: null
      });

      await indexPage(pageData);

      const wordIndex = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId, url: pageData.url })
        .toArray();

      assert.ok(wordIndex.length > 0, 'Should create entries for body text');
    });

    it('should handle very long text content', async () => {
      const longText = 'word '.repeat(10000); // 10000 words
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: 'Test',
        textContent: longText
      };

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId,
        indexedAt: null
      });

      await indexPage(pageData);

      const wordIndex = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId, url: pageData.url })
        .toArray();

      const wordEntry = wordIndex.find(e => e.word === 'word');
      assert.ok(wordEntry, 'Should have entry for "word"');
      assert.strictEqual(wordEntry.frequency, 10000, 'Should count all occurrences');
    });

    it('should handle special characters in text', async () => {
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: 'Test @#$%',
        textContent: 'hello!!! world??? test...'
      };

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId,
        indexedAt: null
      });

      await indexPage(pageData);

      const wordIndex = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId, url: pageData.url })
        .toArray();

      const words = wordIndex.map(e => e.word);
      assert.ok(words.includes('hello'), 'Should include "hello"');
      assert.ok(words.includes('world'), 'Should include "world"');
      assert.ok(words.includes('test'), 'Should include "test"');
    });

    it('should handle Unicode characters', async () => {
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: 'Café Résumé',
        textContent: 'café résumé naïve'
      };

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData.url,
        crawlJobId: pageData.crawlJobId,
        indexedAt: null
      });

      await indexPage(pageData);

      const wordIndex = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId, url: pageData.url })
        .toArray();

      // Unicode characters should be preserved
      const words = wordIndex.map(e => e.word);
      assert.ok(words.some(w => w.includes('caf')), 'Should handle accented characters');
    });

    it('should handle different crawl jobs separately', async () => {
      const job1Id = new ObjectId();
      const job2Id = new ObjectId();

      const pageData1 = {
        url: 'https://example.com/test',
        crawlJobId: job1Id,
        origin: 'https://example.com',
        depth: 0,
        title: 'Job1',
        textContent: 'content from job1'
      };

      const pageData2 = {
        url: 'https://example.com/test',
        crawlJobId: job2Id,
        origin: 'https://example.com',
        depth: 0,
        title: 'Job2',
        textContent: 'content from job2'
      };

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData1.url,
        crawlJobId: job1Id,
        indexedAt: null
      });

      await db.collection(COLLECTIONS.PAGES).insertOne({
        url: pageData2.url,
        crawlJobId: job2Id,
        indexedAt: null
      });

      await indexPage(pageData1);
      await indexPage(pageData2);

      const job1Entries = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId: job1Id })
        .toArray();

      const job2Entries = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId: job2Id })
        .toArray();

      assert.ok(job1Entries.length > 0, 'Job1 should have entries');
      assert.ok(job2Entries.length > 0, 'Job2 should have entries');

      const job1Words = job1Entries.map(e => e.word);
      const job2Words = job2Entries.map(e => e.word);

      assert.ok(job1Words.includes('job1'), 'Job1 should have "job1" word');
      assert.ok(job2Words.includes('job2'), 'Job2 should have "job2" word');
    });
  });

  describe('indexPage() - error handling', () => {
    beforeEach(async () => {
      await cleanupTestDb();
    });

    it('should handle missing page document gracefully', async () => {
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: 'Test',
        textContent: 'hello world'
      };

      // Don't create a page entry - should still work
      await indexPage(pageData);

      // The word index should still be created
      const wordIndex = await db.collection(COLLECTIONS.WORD_INDEX)
        .find({ crawlJobId, url: pageData.url })
        .toArray();

      assert.ok(wordIndex.length > 0, 'Should create word index entries');
    });

    it('should handle database connection errors', async () => {
      // This test verifies that errors are caught and logged
      // without crashing the process
      const pageData = {
        url: 'https://example.com/test',
        crawlJobId,
        origin: 'https://example.com',
        depth: 0,
        title: 'Test',
        textContent: 'hello world'
      };

      // Mock getDb to throw an error
      const originalGetDb = require('../../src/db/mongo').getDb;
      require('../../src/db/mongo').getDb = () => {
        throw new Error('MongoDB not connected');
      };

      // Should not throw, should handle error gracefully
      let errorThrown = false;
      try {
        await indexPage(pageData);
      } catch (error) {
        errorThrown = true;
      }

      // Restore original getDb
      require('../../src/db/mongo').getDb = originalGetDb;

      // The function should catch and log the error, not throw
      assert.strictEqual(errorThrown, false, 'Should handle database errors gracefully');
    });
  });

  describe('STOP_WORDS constant', () => {
    it('should be a Set', () => {
      assert.ok(STOP_WORDS instanceof Set);
    });

    it('should contain common English stop words', () => {
      assert.ok(STOP_WORDS.has('the'));
      assert.ok(STOP_WORDS.has('a'));
      assert.ok(STOP_WORDS.has('an'));
      assert.ok(STOP_WORDS.has('and'));
      assert.ok(STOP_WORDS.has('or'));
      assert.ok(STOP_WORDS.has('but'));
      assert.ok(STOP_WORDS.has('in'));
      assert.ok(STOP_WORDS.has('on'));
      assert.ok(STOP_WORDS.has('at'));
      assert.ok(STOP_WORDS.has('to'));
    });

    it('should have a reasonable size', () => {
      assert.ok(STOP_WORDS.size > 100, 'Should have at least 100 stop words');
      assert.ok(STOP_WORDS.size < 200, 'Should have less than 200 stop words');
    });

    it('should include pronouns', () => {
      assert.ok(STOP_WORDS.has('i'));
      assert.ok(STOP_WORDS.has('you'));
      assert.ok(STOP_WORDS.has('he'));
      assert.ok(STOP_WORDS.has('she'));
      assert.ok(STOP_WORDS.has('it'));
      assert.ok(STOP_WORDS.has('we'));
      assert.ok(STOP_WORDS.has('they'));
    });

    it('should include common verbs', () => {
      assert.ok(STOP_WORDS.has('is'));
      assert.ok(STOP_WORDS.has('are'));
      assert.ok(STOP_WORDS.has('was'));
      assert.ok(STOP_WORDS.has('were'));
      assert.ok(STOP_WORDS.has('be'));
      assert.ok(STOP_WORDS.has('have'));
      assert.ok(STOP_WORDS.has('has'));
      assert.ok(STOP_WORDS.has('had'));
    });
  });
});
