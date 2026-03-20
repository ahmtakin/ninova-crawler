/**
 * Tests for the HTML parser (regex-based).
 * Run: node --test tests/parser.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { extractLinks, extractTitle, extractText, extractMetaDescription, decodeEntities } = require('../src/crawler/parser.js');

describe('extractLinks', () => {
  it('should extract absolute URLs from anchor tags', () => {
    const html = '<a href="https://example.com/page1">Link 1</a><a href="https://example.com/page2">Link 2</a>';
    const links = extractLinks(html, 'https://example.com');
    assert.deepStrictEqual(links, ['https://example.com/page1', 'https://example.com/page2']);
  });

  it('should resolve relative URLs against base', () => {
    const html = '<a href="/about">About</a><a href="contact">Contact</a>';
    const links = extractLinks(html, 'https://example.com/pages/');
    assert.ok(links.includes('https://example.com/about'));
    assert.ok(links.includes('https://example.com/pages/contact'));
  });

  it('should filter out javascript: and mailto: links', () => {
    const html = '<a href="javascript:void(0)">JS</a><a href="mailto:test@test.com">Email</a><a href="https://valid.com">Valid</a>';
    const links = extractLinks(html, 'https://example.com');
    assert.deepStrictEqual(links, ['https://valid.com']);
  });

  it('should handle single and double quoted href values', () => {
    const html = `<a href="https://double.com">D</a><a href='https://single.com'>S</a>`;
    const links = extractLinks(html, 'https://example.com');
    assert.ok(links.includes('https://double.com'));
    assert.ok(links.includes('https://single.com'));
  });

  it('should deduplicate URLs', () => {
    const html = '<a href="https://example.com">A</a><a href="https://example.com">B</a>';
    const links = extractLinks(html, 'https://example.com');
    assert.strictEqual(links.length, 1);
  });
});

describe('extractTitle', () => {
  it('should extract title from HTML', () => {
    const html = '<html><head><title>Hello World</title></head><body></body></html>';
    assert.strictEqual(extractTitle(html), 'Hello World');
  });

  it('should return empty string when no title', () => {
    const html = '<html><body>No title here</body></html>';
    assert.strictEqual(extractTitle(html), '');
  });
});

describe('extractText', () => {
  it('should strip HTML tags and return clean text', () => {
    const html = '<p>Hello <strong>world</strong></p><p>Second paragraph</p>';
    const text = extractText(html);
    assert.ok(text.includes('Hello'));
    assert.ok(text.includes('world'));
    assert.ok(text.includes('Second paragraph'));
  });

  it('should remove script and style blocks', () => {
    const html = '<script>var x = 1;</script><style>.a{color:red}</style><p>Visible</p>';
    const text = extractText(html);
    assert.ok(!text.includes('var x'));
    assert.ok(!text.includes('color'));
    assert.ok(text.includes('Visible'));
  });

  it('should decode HTML entities', () => {
    const html = '<p>Tom &amp; Jerry &lt;3</p>';
    const text = extractText(html);
    assert.ok(text.includes('Tom & Jerry <3'));
  });
});

describe('decodeEntities', () => {
  it('should decode named entities', () => {
    assert.strictEqual(decodeEntities('&amp;'), '&');
    assert.strictEqual(decodeEntities('&lt;'), '<');
    assert.strictEqual(decodeEntities('&gt;'), '>');
  });

  it('should decode numeric entities', () => {
    assert.strictEqual(decodeEntities('&#65;'), 'A');
    assert.strictEqual(decodeEntities('&#x41;'), 'A');
  });
});
