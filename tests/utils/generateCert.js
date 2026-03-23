/**
 * TLS Certificate Generation Utility for Testing
 *
 * Generates self-signed X.509 certificates and private keys
 * for use in HTTPS test servers.
 *
 * Uses the 'selfsigned' package to create:
 * - 2048-bit RSA key pair
 * - SHA-256 signed certificate
 * - Valid for 365 days
 * - Subject Alternative Names for localhost, *.localhost, 127.0.0.1, ::1
 *
 * @module tests/utils/generateCert
 */

const selfsigned = require('selfsigned');
const path = require('path');
const fs = require('fs').promises;

/**
 * Generate a self-signed TLS certificate and private key for testing.
 *
 * The certificate includes Subject Alternative Names (SANs) for:
 * - localhost
 * - *.localhost (wildcard for subdomains)
 * - 127.0.0.1 (IPv4 loopback)
 * - ::1 (IPv6 loopback)
 *
 * Certificate properties:
 * - Key size: 2048 bits (RSA)
 * - Signature algorithm: SHA-256
 * - Validity: 365 days from generation
 * - Common Name: localhost
 *
 * @returns {Promise<{key: string, cert: string}>} Object containing:
 *   - key: PEM-encoded private key
 *   - cert: PEM-encoded X.509 certificate
 *
 * @example
 * ```javascript
 * const { generateTestCertificate } = require('./tests/utils/generateCert');
 *
 * // Generate certificate
 * const { key, cert } = await generateTestCertificate();
 *
 * // Use with https.createServer
 * const https = require('https');
 * const server = https.createServer({ key, cert }, app);
 * ```
 */
async function generateTestCertificate() {
  const attrs = [{ name: 'commonName', value: 'localhost' }];

  const opts = {
    keySize: 2048,
    days: 365,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'basicConstraints',
        cA: false,
      },
      {
        name: 'keyUsage',
        keyCertSign: false,
        digitalSignature: true,
        nonRepudiation: false,
        keyEncipherment: true,
        dataEncipherment: true,
      },
      {
        name: 'extKeyUsage',
        serverAuth: true,
        clientAuth: true,
      },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' }, // DNS name
          { type: 2, value: '*.localhost' }, // Wildcard DNS
          { type: 7, ip: '127.0.0.1' }, // IPv4
          { type: 7, ip: '::1' }, // IPv6
        ],
      },
    ],
  };

  const pems = await selfsigned.generate(attrs, opts);

  return {
    key: pems.private,
    cert: pems.cert,
  };
}

/**
 * Generate and save certificate files to disk.
 *
 * Creates key.pem and cert.pem files in the specified directory.
 *
 * @param {string} dirPath - Directory path where files will be saved
 * @returns {Promise<{keyPath: string, certPath: string}>} Paths to created files
 *
 * @example
 * ```javascript
 * const { generateAndSaveCertificate } = require('./tests/utils/generateCert');
 * const { keyPath, certPath } = await generateAndSaveCertificate('./test-fixtures');
 * ```
 */
async function generateAndSaveCertificate(dirPath) {
  const { key, cert } = await generateTestCertificate();

  // Ensure directory exists
  await fs.mkdir(dirPath, { recursive: true });

  const keyPath = path.join(dirPath, 'key.pem');
  const certPath = path.join(dirPath, 'cert.pem');

  await Promise.all([
    fs.writeFile(keyPath, key, { mode: 0o600 }), // Restrictive permissions for private key
    fs.writeFile(certPath, cert, { mode: 0o644 }),
  ]);

  return { keyPath, certPath };
}

module.exports = {
  generateTestCertificate,
  generateAndSaveCertificate,
};
