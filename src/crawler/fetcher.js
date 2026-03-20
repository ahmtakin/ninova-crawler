/**
 * Native HTTP page fetcher.
 *
 * CONSTRAINT: Uses ONLY Node.js built-in http/https modules.
 * NO axios, node-fetch, got, or any third-party HTTP client.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Fetch a web page using native http/https modules.
 * Handles redirects (up to config.maxRedirects), timeouts, and body size limits.
 *
 * @param {string} url - The URL to fetch
 * @param {object} [options]
 * @param {number} [options.timeout] - Request timeout in ms
 * @param {number} [options.maxSize] - Max response body size in bytes
 * @param {number} [options.redirectCount] - Internal: current redirect depth
 * @returns {Promise<{statusCode: number, headers: object, body: string, finalUrl: string}>}
 */
async function fetchPage(url, options = {}) {
  const timeout = options.timeout || config.requestTimeoutMs;
  const maxSize = options.maxSize || config.maxPageSizeBytes;
  const redirectCount = options.redirectCount || 0;
  const maxRedirects = config.maxRedirects;

  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const requestOptions = {
        method: 'GET',
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (protocol === https ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {
          'User-Agent': config.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
    }
      };

      const req = protocol.request(requestOptions, (res) => {
        // Handle redirects
        if ([301, 302, 307, 308].includes(res.statusCode)) {
          if (redirectCount >= maxRedirects) {
            return reject(new Error(`Too many redirects (max: ${maxRedirects})`));
          }

          const location = res.headers.location;
          if (!location) {
            return reject(new Error(`Redirect with no Location header`));
          }

          // Resolve relative Location against current URL
          const redirectUrl = new URL(location, url).href;

          // Follow redirect recursively
          return fetchPage(redirectUrl, { ...options, redirectCount: redirectCount + 1 })
            .then(resolve)
            .catch(reject);
        }

        // Check content length header
        const contentLength = parseInt(res.headers['content-length'] || '0', 10);
        if (contentLength > maxSize) {
          req.destroy();
          return reject(new Error(`Response too large: ${contentLength} bytes`));
        }

        const chunks = [];
        let totalSize = 0;

        res.on('data', (chunk) => {
          totalSize += chunk.length;
          if (totalSize > maxSize) {
            req.destroy();
            reject(new Error(`Response body exceeds max size: ${totalSize} bytes`));
          } else {
            chunks.push(chunk);
          }
        });

        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body,
            finalUrl: url
          });
        });

        res.on('error', (err) => {
          reject(new Error(`Response error: ${err.message}`));
        });
      });

      req.setTimeout(timeout, () => {
        req.destroy();
        reject(new Error(`Request timeout after ${timeout}ms`));
      });

      req.on('error', (err) => {
        reject(new Error(`Request error: ${err.message}`));
      });

      req.end();

    } catch (err) {
      reject(new Error(`URL parse error: ${err.message}`));
    }
  });
}

module.exports = { fetchPage };
