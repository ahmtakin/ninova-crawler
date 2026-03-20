/**
 * URL normalization, validation, and comparison utilities.
 * Uses the built-in URL class (allowed — it's part of Node.js core).
 */

/**
 * Normalize a URL: resolve relative paths, strip fragments, lowercase host,
 * remove trailing slashes, sort query params.
 * @param {string} rawUrl - The URL to normalize (can be relative)
 * @param {string} [baseUrl] - Base URL for resolving relative paths
 * @returns {string|null} Normalized absolute URL, or null if invalid
 */
function normalizeUrl(rawUrl, baseUrl) {
  try {
    let url;

    // Handle relative URLs
    if (baseUrl) {
      try {
        url = new URL(rawUrl, baseUrl);
      } catch {
        return null;
      }
    } else {
      try {
        url = new URL(rawUrl);
      } catch {
        return null;
      }
    }

    // Only allow http and https protocols
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    // Strip hash/fragment
    url.hash = '';

    // Lowercase hostname
    url.hostname = url.hostname.toLowerCase();

    // Check if pathname is just "/" and remember it
    const isRootPath = url.pathname === '/';

    // Remove trailing slash (but not for root path which stays as "/")
    if (!isRootPath && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    // Sort query parameters alphabetically
    if (url.search) {
      const params = new URLSearchParams(url.search);
      const sortedParams = Array.from(params.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      url.search = new URLSearchParams(sortedParams).toString();
    }

    // Construct href manually - omit pathname if it's just "/"
    let result = url.protocol + '//' + url.hostname;
    if (url.port) result += ':' + url.port;
    if (url.pathname && url.pathname !== '/') result += url.pathname;
    if (url.search) result += url.search;

    return result;
  } catch {
    return null;
  }
}

/**
 * Check if a URL is valid for crawling.
 * @param {string} url
 * @returns {boolean}
 */
function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Check if two URLs share the same hostname.
 * @param {string} url1
 * @param {string} url2
 * @returns {boolean}
 */
function isSameDomain(url1, url2) {
  try {
    const u1 = new URL(url1);
    const u2 = new URL(url2);
    return u1.hostname === u2.hostname;
  } catch {
    return false;
  }
}

module.exports = { normalizeUrl, isValidUrl, isSameDomain };
