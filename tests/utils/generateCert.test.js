// tests/utils/generateCert.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { generateTestCertificate } = require('./generateCert');

describe('Certificate Generation', () => {
  it('should generate valid key and certificate', async () => {
    const { key, cert } = await generateTestCertificate();

    // Verify key is a valid PEM string
    assert.ok(key.includes('-----BEGIN'));
    assert.ok(key.includes('PRIVATE KEY-----'));

    // Verify cert is a valid PEM string
    assert.ok(cert.includes('-----BEGIN CERTIFICATE-----'));
    assert.ok(cert.includes('-----END CERTIFICATE-----'));

    // Verify cert is not empty
    assert.ok(key.length > 0);
    assert.ok(cert.length > 0);

    // Verify cert has reasonable length for a self-signed cert
    assert.ok(cert.length > 800 && cert.length < 2000, 'Certificate should be reasonable length');
  });

  it('should generate certificates with correct properties', async () => {
    const { key, cert } = await generateTestCertificate();

    // Verify RSA 2048-bit key (typical PEM length for base64-encoded 2048-bit RSA key)
    assert.ok(key.length > 1600 && key.length < 2000, 'Key size suggests 2048-bit RSA');

    // Verify certificate has PEM structure
    assert.ok(cert.startsWith('-----BEGIN CERTIFICATE-----'), 'Should start with CERTIFICATE prefix');
    assert.ok(cert.endsWith('-----END CERTIFICATE-----'), 'Should end with CERTIFICATE suffix');
    assert.match(cert, /MIID[A-Za-z0-9+/=]+/, 'Should have valid base64-encoded certificate content');
  });

  it('should generate different certificates on each call', async () => {
    const { key: key1, cert: cert1 } = await generateTestCertificate();

    // Wait a bit to ensure different serial/timestamp
    await new Promise(resolve => setTimeout(resolve, 10));

    const { key: key2, cert: cert2 } = await generateTestCertificate();

    // Keys should be different (different serial numbers)
    assert.notStrictEqual(key1, key2);
    assert.notStrictEqual(cert1, cert2);
  });
});
