/**
 * Regex-based HTML parser for link and text extraction.
 *
 * CONSTRAINT: NO cheerio, jsdom, htmlparser2, or any DOM parsing library.
 * Uses only regex and string operations.
 */

const { normalizeUrl } = require('../utils/urlUtils');

/**
 * Common HTML entities to decode.
 */
const HTML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&#x27;': "'", '&apos;': "'", '&nbsp;': ' ',
  '&#x2F;': '/', '&#47;': '/', '&copy;': '©', '&reg;': '®',
  '&euro;': '€', '&pound;': '£', '&cent;': '¢', '&yen;': '¥',
};

/**
 * Extract all <a href="..."> links from HTML.
 * @param {string} html - Raw HTML string
 * @param {string} baseUrl - Base URL for resolving relative links
 * @returns {string[]} Array of normalized absolute URLs
 */
function extractLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();

  // Regex to match href attributes in anchor tags
  // Handles href="...", href='...', and href=... (unquoted)
  const hrefRegex = /<a[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/gi;
  let match;

  while ((match = hrefRegex.exec(html)) !== null) {
    // Get the captured group (whichever matched)
    const href = match[1] || match[2] || match[3];
    if (!href) continue;

    // Decode HTML entities
    const decodedHref = decodeEntities(href);

    // Normalize URL
    const normalized = normalizeUrl(decodedHref, baseUrl);
    if (!normalized) continue;

    // Filter out javascript:, mailto:, tel:, data: URIs
    const lowerHref = normalized.toLowerCase();
    if (lowerHref.startsWith('javascript:') ||
        lowerHref.startsWith('mailto:') ||
        lowerHref.startsWith('tel:') ||
        lowerHref.startsWith('data:')) {
      continue;
    }

    // Deduplicate
    if (!seen.has(normalized)) {
      seen.add(normalized);
      links.push(normalized);
    }
  }

  return links;
}

/**
 * Extract the <title> content from HTML.
 * @param {string} html
 * @returns {string} Title text, or empty string if not found
 */
function extractTitle(html) {
  const titleRegex = /<title[^>]*>([\s\S]*?)<\/title>/i;
  const match = titleRegex.exec(html);
  if (match) {
    return decodeEntities(match[1].trim());
  }
  return '';
}

/**
 * Extract visible text content from HTML, stripping all tags.
 * @param {string} html
 * @returns {string} Clean text with collapsed whitespace
 */
function extractText(html) {
  let text = html;

  // Remove script tags and content
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');

  // Remove style tags and content
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');

  // Remove noscript tags and content
  text = text.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ');

  // Remove all HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = decodeEntities(text);

  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * Extract meta description from HTML.
 * @param {string} html
 * @returns {string} Description text, or empty string
 */
function extractMetaDescription(html) {
  // Match meta name="description" content="..."
  const metaRegex = /<meta\s+name\s*=\s*["']description["']\s+content\s*=\s*["']([^"']*)["']/gi;
  let match = metaRegex.exec(html);
  if (match) return decodeEntities(match[1].trim());

  // Try alternate order: content="" name="description"
  const altRegex = /<meta\s+content\s*=\s*["']([^"']*)["']\s+name\s*=\s*["']description["']/gi;
  match = altRegex.exec(html);
  if (match) return decodeEntities(match[1].trim());

  return '';
}

/**
 * Decode HTML entities in a string.
 * @param {string} str
 * @returns {string}
 */
function decodeEntities(str) {
  let result = str;

  // Replace named entities
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    result = result.split(entity).join(char);
  }

  // Replace numeric decimal entities: &#123;
  result = result.replace(/&#(\d+);/g, (match, dec) => {
    const code = parseInt(dec, 10);
    return code <= 0xFFFF ? String.fromCharCode(code) : match;
  });

  // Replace numeric hexadecimal entities: &#x1F;
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => {
    const code = parseInt(hex, 16);
    return code <= 0xFFFF ? String.fromCharCode(code) : match;
  });

  return result;
}

module.exports = { extractLinks, extractTitle, extractText, extractMetaDescription, decodeEntities };
