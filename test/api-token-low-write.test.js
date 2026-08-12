const assert = require('assert');

class MemoryKV {
  constructor() {
    this.store = new Map();
    this.putCalls = 0;
  }

  async put(key, value = '', options = {}) {
    this.putCalls += 1;
    this.store.set(String(key), {
      value: String(value ?? ''),
      metadata: options?.metadata || null,
    });
  }

  async get(key, options = {}) {
    const entry = this.store.get(String(key));
    if (!entry) return null;
    if (options?.type === 'json') {
      return JSON.parse(entry.value);
    }
    return entry.value;
  }
}

describe('API token low-KV-write mode', function () {
  async function invokeMiddleware(env, token) {
    const { onRequest: middleware } = await import('../functions/api/v1/_middleware.js');
    const request = new Request('https://example.com/api/v1/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const waiters = [];
    const response = await middleware({
      request,
      env,
      data: {},
      next: () => new Response('ok', { status: 200 }),
      waitUntil: (promise) => {
        waiters.push(Promise.resolve(promise));
      },
    });
    await Promise.allSettled(waiters);
    return response;
  }

  it('updates lastUsedAt at most once per hour', async function () {
    const { createApiToken } = await import('../functions/utils/api-token.js');
    const env = {
      img_url: new MemoryKV(),
      MINIMIZE_KV_WRITES: 'true',
    };
    const created = await createApiToken({ name: 'test-token', scopes: ['upload'] }, env);
    const writesBeforeRequest = env.img_url.putCalls;

    const firstResponse = await invokeMiddleware(env, created.token);
    assert.strictEqual(firstResponse.status, 200);
    assert.strictEqual(env.img_url.putCalls, writesBeforeRequest + 1);

    const tokenRecord = await env.img_url.get(`api_token:${created.record.id}`, { type: 'json' });
    assert.ok(Number(tokenRecord?.lastUsedAt || 0) > 0);

    const secondResponse = await invokeMiddleware(env, created.token);
    assert.strictEqual(secondResponse.status, 200);
    assert.strictEqual(env.img_url.putCalls, writesBeforeRequest + 1);
  });

  it('keeps updating lastUsedAt on every request outside low-write mode', async function () {
    const { createApiToken } = await import('../functions/utils/api-token.js');
    const env = { img_url: new MemoryKV() };
    const created = await createApiToken({ name: 'test-token', scopes: ['upload'] }, env);
    const writesBeforeRequest = env.img_url.putCalls;

    const firstResponse = await invokeMiddleware(env, created.token);
    const secondResponse = await invokeMiddleware(env, created.token);

    assert.strictEqual(firstResponse.status, 200);
    assert.strictEqual(secondResponse.status, 200);
    assert.strictEqual(env.img_url.putCalls, writesBeforeRequest + 2);
  });
});
