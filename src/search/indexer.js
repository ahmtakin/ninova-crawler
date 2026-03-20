/**
 * Page Indexer — tokenizes page content and stores in inverted word index.
 *
 * For each crawled page, this module:
 * 1. Tokenizes the page text (lowercase, strip punctuation, remove stop words)
 * 2. Counts word frequencies
 * 3. Stores word→URL mappings in the word_index collection
 */

const { COLLECTIONS } = require('../db/models');
const { getDb } = require('../db/mongo');
const logger = require('../utils/logger');

/**
 * Common English stop words to filter out during indexing.
 * These words appear too frequently to be useful for search ranking.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'need',
  'dare', 'ought', 'used', 'it', 'its', 'he', 'she', 'they', 'we',
  'you', 'i', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his',
  'our', 'their', 'this', 'that', 'these', 'those', 'what', 'which',
  'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'because', 'if', 'then', 'else', 'while', 'about', 'up',
  'out', 'off', 'over', 'under', 'again', 'further', 'once', 'here',
  'there', 'any', 'also', 'after', 'before', 'above', 'below', 'between',
  'during', 'through', 'into', 'get', 'got', 'go', 'going', 'gone',
  'come', 'came', 'make', 'made', 'take', 'took', 'give', 'gave',
  'new', 'old', 'see', 'now', 'way', 'long', 'say', 'said',
]);

/**
 * Tokenize a string into searchable words.
 * @param {string} text - Raw text to tokenize
 * @returns {string[]} Array of lowercase tokens (stop words removed, min 2 chars)
 */
function tokenize(text) {
  if (!text || typeof text !== 'string') return [];

  // Lowercase the text
  const lower = text.toLowerCase();

  // Split on non-alphanumeric characters
  const tokens = lower.split(/[^a-z0-9]+/);

  // Filter out tokens shorter than 2 characters and stop words
  return tokens.filter(token => token.length >= 2 && !STOP_WORDS.has(token));
}

/**
 * Count word frequencies in a token array.
 * @param {string[]} tokens
 * @returns {Map<string, number>} word → frequency
 */
function countFrequencies(tokens) {
  const freq = new Map();

  for (const token of tokens) {
    const count = freq.get(token) || 0;
    freq.set(token, count + 1);
  }

  return freq;
}

/**
 * Index a crawled page into the inverted word index.
 * Called after each page is successfully fetched and parsed.
 *
 * @param {object} pageData
 * @param {string} pageData.url - Page URL
 * @param {import('mongodb').ObjectId} pageData.crawlJobId - Crawl job ID
 * @param {string} pageData.origin - Crawl origin URL
 * @param {number} pageData.depth - Page depth
 * @param {string} pageData.title - Extracted page title
 * @param {string} pageData.textContent - Extracted page text
 */
async function indexPage(pageData) {
  try {
    const db = getDb();
    const wordIndexCollection = db.collection(COLLECTIONS.WORD_INDEX);
    const pagesCollection = db.collection(COLLECTIONS.PAGES);

    // Tokenize body text
    const bodyTokens = tokenize(pageData.textContent);
    const bodyFreq = countFrequencies(bodyTokens);

    // Tokenize title
    const titleTokens = tokenize(pageData.title || '');
    const titleTokenSet = new Set(titleTokens);

    // Build bulk operations for word index
    const bulkOps = [];

    for (const [word, frequency] of bodyFreq.entries()) {
      const inTitle = titleTokenSet.has(word);

      let position = 'body';
      if (inTitle && frequency === 0) {
        position = 'title';
      } else if (inTitle) {
        position = 'both';
      }

      bulkOps.push({
        updateOne: {
          filter: {
            word,
            url: pageData.url,
            crawlJobId: pageData.crawlJobId
          },
          update: {
            $set: {
              frequency,
              inTitle,
              position,
              origin: pageData.origin,
              depth: pageData.depth
            }
          },
          upsert: true
        }
      });
    }

    // Also index words that appear only in title
    for (const token of titleTokens) {
      if (!bodyFreq.has(token)) {
        bulkOps.push({
          updateOne: {
            filter: {
              word: token,
              url: pageData.url,
              crawlJobId: pageData.crawlJobId
            },
            update: {
              $set: {
                frequency: 0,
                inTitle: true,
                position: 'title',
                origin: pageData.origin,
                depth: pageData.depth
              }
            },
            upsert: true
          }
        });
      }
    }

    // Execute bulk write if there are operations
    if (bulkOps.length > 0) {
      await wordIndexCollection.bulkWrite(bulkOps, { ordered: false });
    }

    // Update the page's indexedAt timestamp
    await pagesCollection.updateOne(
      { url: pageData.url, crawlJobId: pageData.crawlJobId },
      { $set: { indexedAt: new Date() } }
    );

    logger.debug('Page indexed', {
      url: pageData.url,
      wordsIndexed: bulkOps.length,
      uniqueWords: bodyFreq.size
    });

  } catch (error) {
    logger.error('Error indexing page', { url: pageData.url, error: error.message });
  }
}

module.exports = { indexPage, tokenize, countFrequencies, STOP_WORDS };
