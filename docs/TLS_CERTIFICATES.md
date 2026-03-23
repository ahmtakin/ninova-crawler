# TLS Certificate Generation in Tests

## Overview

Test TLS certificates are generated at runtime using the `selfsigned` npm package. This provides better security and flexibility compared to hardcoded certificates.

## Usage

### In Tests

To use HTTPS mock servers in tests:

```javascript
const { setupTestCertificates, createMockServer, closeMockServer } = require('../setup');

describe('HTTPS Tests', () => {
  let mockServer;
  let mockUrl;

  before(async () => {
    // Initialize certificates
    const { key, cert } = await setupTestCertificates();

    // Create HTTPS mock server
    const { server, url } = await createMockServer(
      [{ path: '/test', status: 200, body: 'Hello' }],
      { https: true, tlsKey: key, tlsCert: cert }
    );

    mockServer = server;
    mockUrl = url;
  });

  after(async () => {
    if (mockServer) {
      await closeMockServer();
    }
  });

  it('should make HTTPS requests', async () => {
    const response = await fetch(mockUrl);
    assert.strictEqual(response.status, 200);
  });
});
```

### Certificate Properties

Generated certificates include:
- **Type**: Self-signed X.509
- **Key size**: 2048-bit RSA
- **Algorithm**: SHA-256 signing
- **Validity**: 365 days from generation
- **Subjects**:
  - Common Name: localhost
- **SAN (Subject Alternative Names)**:
  - DNS: localhost, *.localhost
  - IP: 127.0.0.1, ::1 (IPv6 localhost)

## Security Notes

- These certificates are **for testing only**
- They are self-signed and not trusted by browsers
- Never use these certificates in production
- Certificates are generated fresh each test run, avoiding key exposure
- The `selfsigned` package is a dev dependency only

## Implementation

The certificate generation uses:
- `selfsigned` npm package for X.509 certificate generation
- Async initialization pattern with caching
- See `tests/utils/generateCert.js` for implementation details

## Self-Test

To verify certificate generation works:

```bash
node tests/setup.js
```

This will run through all setup utilities including certificate generation and HTTPS server creation.
