const assert = require('node:assert');

describe('Cloudflare Pages upload route', function () {
  it('serves the root upload UI for GET /upload without invoking upload POST logic', async function () {
    const { onRequestGet } = await import('../functions/upload.js');
    let requestedPath = '';

    const response = await onRequestGet({
      request: new Request('https://example.com/upload'),
      env: {
        ASSETS: {
          fetch(request) {
            requestedPath = new URL(request.url).pathname;
            return new Response('<!doctype html><title>K-Vault</title>', {
              status: 200,
              headers: { 'Content-Type': 'text/html' },
            });
          },
        },
      },
    });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(requestedPath, '/index.html');
    assert.match(await response.text(), /K-Vault/);
  });
});

describe('Cloudflare Pages request telemetry', function () {
  it('omits credentials and query parameters from request tags and context', async function () {
    const { telemetryData } = await import('../functions/utils/middleware.js');
    const captured = [];
    const request = new Request('https://example.com/api/v1/upload?password=test-share-password', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-bearer', Cookie: 'session=test-session' },
    });
    request.cf = {};
    const response = telemetryData({
      request,
      env: {},
      data: { sentry: {
        setTag: (...args) => captured.push(args),
        setContext: (...args) => captured.push(args),
        startTransaction: () => ({ finish() {} }),
      } },
      next: () => new Response('ok'),
    });
    assert.strictEqual(response.status, 200);
    const telemetry = JSON.stringify(captured);
    assert.match(telemetry, /\/api\/v1\/upload/);
    assert.doesNotMatch(telemetry, /test-bearer|test-session|test-share-password/);
  });
});
