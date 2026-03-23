// tests/utils/generateCert.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { generateTestCertificate } = require('../utils/generateCert');

describe('Certificate Generation', () => {
  it('should generate valid key and certificate', async () => {
    const { key, cert } = await generateTestCertificate();

    // Verify key is a valid PEM string
    assert.ok(key.includes('-----BEGIN'));
    assert.ok(key.includes('PRIVATE KEY-----'));

    // Verify cert is a valid PEM string
    assert.ok(cert.includes('-----BEGIN CERTIFICATE-----'));
    assert.ok(cert.includes('-----END CERTIFICATE-----'));

    // Verify cert contains localhost (using X509 parsing)
    const crypto = require('crypto');
    const x509 = new crypto.X509Certificate(cert);
    assert.ok(x509.subject.includes('localhost'), 'Subject should include localhost');

    // Verify cert is not empty
    assert.ok(key.length > 0);
    assert.ok(cert.length > 0);
  });

  it('should generate certificates with correct properties', async () => {
    const { key, cert } = await generateTestCertificate();

    // Verify RSA 2048-bit key
    const crypto = require('crypto');
    const x509 = new crypto.X509Certificate(cert);
    const publicKey = x509.publicKey;
    assert.strictEqual(publicKey.asymmetricKeyDetails.modulusLength, 2048, 'Should be 2048-bit RSA key');

    // Verify certificate structure
    assert.ok(x509.subject.includes('localhost'), 'Common name should be localhost');
    assert.ok(x509.subjectAltName, 'Should have SAN extension');
    assert.ok(x509.subjectAltName.includes('localhost'), 'SAN should include localhost');
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
