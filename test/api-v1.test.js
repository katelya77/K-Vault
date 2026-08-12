const assert = require('assert');

class MemoryKV {
  constructor() {
    this.store = new Map();
    this.getCalls = 0;
    this.putCalls = 0;
    this.getWithMetadataCalls = 0;
  }

  async put(key, value = '', options = {}) {
    this.putCalls += 1;
    this.store.set(String(key), {
      value: String(value ?? ''),
      metadata: options?.metadata || null,
    });
  }

  async get(key, options = {}) {
    this.getCalls += 1;
    const entry = this.store.get(String(key));
    if (!entry) return null;
    if (options?.type === 'json') {
      try {
        return JSON.parse(entry.value);
      } catch {
        return null;
      }
    }
    return entry.value;
  }

  async delete(key) {
    this.store.delete(String(key));
  }

  async list({ prefix = '', limit = 1000, cursor } = {}) {
    const keys = [...this.store.entries()]
      .filter(([name]) => String(name).startsWith(String(prefix || '')))
      .map(([name, entry]) => ({
        name,
        metadata: entry.metadata || null,
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const offset = Math.max(0, Number.parseInt(String(cursor || '0'), 10) || 0);
    const page = keys.slice(offset, offset + limit);
    const nextOffset = offset + limit < keys.length ? String(offset + limit) : undefined;

    return {
      keys: page,
      list_complete: nextOffset == null,
      cursor: nextOffset,
    };
  }

  async getWithMetadata(key) {
    this.getWithMetadataCalls += 1;
    const entry = this.store.get(String(key));
    if (!entry) return null;
    return {
      value: entry.value,
      metadata: entry.metadata || null,
    };
  }
}

class MemoryR2 {
  constructor() {
    this.objects = new Map();
  }

  put(key, bytes) {
    const normalized = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(String(bytes || ''));
    this.objects.set(String(key), normalized);
  }

  async head(key) {
    const body = this.objects.get(String(key));
    if (!body) return null;
    return { size: body.byteLength };
  }

  async get(key, options = {}) {
    const body = this.objects.get(String(key));
    if (!body) return null;

    if (options?.range) {
      const offset = Number(options.range.offset || 0);
      const length = Number(options.range.length || Math.max(0, body.byteLength - offset));
      const sliced = body.slice(offset, offset + length);
      return {
        body: sliced,
        size: sliced.byteLength,
      };
    }

    return {
      body,
      size: body.byteLength,
    };
  }

  async delete(key) {
    this.objects.delete(String(key));
  }
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(String(input || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function parseJson(response) {
  return JSON.parse(await response.text());
}

async function createEnvAndToken(scopes = ['read'], tokenOptions = {}) {
  const { createApiToken } = await import('../functions/utils/api-token.js');
  const env = {
    img_url: new MemoryKV(),
    R2_BUCKET: new MemoryR2(),
  };

  const created = await createApiToken(
    {
      name: 'test-token',
      scopes,
      ...tokenOptions,
    },
    env
  );

  return {
    env,
    token: created.token,
    tokenInfo: created.record,
  };
}

describe('API v1 middleware auth', function () {
  it('rejects missing token', async function () {
    const { onRequest: middleware } = await import('../functions/api/v1/_middleware.js');
    const { env } = await createEnvAndToken(['upload']);

    const request = new Request('https://example.com/api/v1/upload', { method: 'POST' });
    const response = await middleware({
      request,
      env,
      data: {},
      next: () => new Response('ok', { status: 200 }),
      waitUntil: () => {},
    });

    const payload = await parseJson(response);
    assert.strictEqual(response.status, 401);
    assert.strictEqual(payload.success, false);
    assert.strictEqual(payload.error.code, 'TOKEN_INVALID');
  });

  it('rejects token without required scope', async function () {
    const { onRequest: middleware } = await import('../functions/api/v1/_middleware.js');
    const { env, token } = await createEnvAndToken(['read']);

    const request = new Request('https://example.com/api/v1/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    const response = await middleware({
      request,
      env,
      data: {},
      next: () => new Response('ok', { status: 200 }),
      waitUntil: () => {},
    });

    const payload = await parseJson(response);
    assert.strictEqual(response.status, 403);
    assert.strictEqual(payload.success, false);
    assert.strictEqual(payload.error.code, 'TOKEN_SCOPE_DENIED');
  });

  it('rejects expired token', async function () {
    const { onRequest: middleware } = await import('../functions/api/v1/_middleware.js');
    const { env, token } = await createEnvAndToken(['read'], {
      expiresAt: Date.now() - 10_000,
    });

    const request = new Request('https://example.com/api/v1/files', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    const response = await middleware({
      request,
      env,
      data: {},
      next: () => new Response('ok', { status: 200 }),
      waitUntil: () => {},
    });

    const payload = await parseJson(response);
    assert.strictEqual(response.status, 401);
    assert.strictEqual(payload.success, false);
    assert.strictEqual(payload.error.code, 'TOKEN_EXPIRED');
  });

  it('allows valid token and updates lastUsedAt', async function () {
    const { onRequest: middleware } = await import('../functions/api/v1/_middleware.js');
    const { env, token, tokenInfo } = await createEnvAndToken(['read']);

    const waiters = [];
    const request = new Request('https://example.com/api/v1/files', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    let nextCalled = false;
    const response = await middleware({
      request,
      env,
      data: {},
      next: () => {
        nextCalled = true;
        return new Response('ok', { status: 200 });
      },
      waitUntil: (promise) => {
        waiters.push(Promise.resolve(promise));
      },
    });

    await Promise.allSettled(waiters);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(nextCalled, true);

    const tokenRecord = await env.img_url.get(`api_token:${tokenInfo.id}`, { type: 'json' });
    assert.ok(Number(tokenRecord?.lastUsedAt || 0) > 0);
  });

  it('uploads signed Telegram files without metadata KV access when metadata is disabled', async function () {
    const { onRequestPost: upload } = await import('../functions/api/v1/upload.js');
    const env = {
      img_url: new MemoryKV(),
      R2_BUCKET: new MemoryR2(),
    };
    Object.assign(env, {
      TG_Bot_Token: 'test-bot-token',
      TG_Chat_ID: '-1001234567890',
      FILE_URL_SECRET: 'test-file-url-secret',
      MINIMIZE_KV_WRITES: 'true',
      TELEGRAM_METADATA_MODE: 'off',
      TG_UPLOAD_NOTIFY: 'false',
      disable_telemetry: 'true',
    });

    const formData = new FormData();
    formData.append('file', new Blob(['image-bytes'], { type: 'image/png' }), 'image.png');
    const request = new Request('https://example.com/api/v1/upload', {
      method: 'POST',
      body: formData,
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      assert.match(String(url), /\/sendDocument$/);
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message_id: 42,
          document: { file_id: 'telegram-image-file-id' },
        },
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      const readsBeforeRequest = env.img_url.getCalls;
      const writesBeforeRequest = env.img_url.putCalls;
      const routeContext = {
        request,
        env,
        data: { apiToken: { id: 'test-token' } },
        next: () => new Response('next', { status: 200 }),
      };

      const response = await upload(routeContext);

      const payload = await parseJson(response);
      assert.strictEqual(response.status, 200);
      assert.match(payload.links.download, /\/file\/tgs_/);
      assert.strictEqual(payload.links.delete, null);
      assert.strictEqual(env.img_url.getCalls, readsBeforeRequest);
      assert.strictEqual(env.img_url.putCalls, writesBeforeRequest);
      assert.strictEqual(env.img_url.getWithMetadataCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('ignores Telegram sharing options when metadata is disabled', async function () {
    const { onRequestPost: upload } = await import('../functions/api/v1/upload.js');
    const env = {
      img_url: new MemoryKV(),
      TG_Bot_Token: 'test-bot-token',
      TG_Chat_ID: '-1001234567890',
      FILE_URL_SECRET: 'test-file-url-secret',
      MINIMIZE_KV_WRITES: 'true',
      TELEGRAM_METADATA_MODE: 'off',
      TG_UPLOAD_NOTIFY: 'false',
      disable_telemetry: 'true',
    };
    const formData = new FormData();
    formData.append('file', new Blob(['image-bytes'], { type: 'image/png' }), 'image.png');
    formData.append('password', 'secret');
    formData.append('expires_in', '86400');
    formData.append('max_downloads', '3');
    formData.append('slug', 'ignored-share-link');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      ok: true,
      result: {
        message_id: 42,
        document: { file_id: 'telegram-image-file-id' },
      },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

    try {
      const response = await upload({
        request: new Request('https://example.com/api/v1/upload', {
          method: 'POST',
          body: formData,
        }),
        env,
        data: { apiToken: { id: 'test-token' } },
        next: () => new Response('next', { status: 200 }),
      });

      const payload = await parseJson(response);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(payload.links.delete, null);
      assert.strictEqual(env.img_url.getWithMetadataCalls, 0);
      assert.strictEqual(env.img_url.putCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('API v1 file share limits', function () {
  async function invokeV1FileGet({ env, token, fileId = 'r2:file.bin', query = '', headers = {} }) {
    const { onRequest: middleware } = await import('../functions/api/v1/_middleware.js');
    const { onRequest: fileRoute } = await import('../functions/api/v1/file/[id].js');

    const encodedId = encodeURIComponent(fileId);
    const requestUrl = `https://example.com/api/v1/file/${encodedId}${query ? `?${query}` : ''}`;
    const request = new Request(requestUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, ...headers },
    });

    const waiters = [];
    const context = {
      request,
      env,
      params: { id: fileId },
      data: {},
      waitUntil: (promise) => {
        waiters.push(Promise.resolve(promise));
      },
      next: () => fileRoute(context),
    };

    const response = await middleware(context);
    await Promise.allSettled(waiters);
    return response;
  }

  async function createFileScenario(shareMetadata = {}) {
    const { env, token } = await createEnvAndToken(['read']);
    const fileKey = 'r2:file.bin';
    env.R2_BUCKET.put('file.bin', new Uint8Array([1, 2, 3, 4]));
    await env.img_url.put(fileKey, '', {
      metadata: {
        TimeStamp: Date.now(),
        ListType: 'None',
        Label: 'None',
        liked: false,
        fileName: 'file.bin',
        fileSize: 4,
        storageType: 'r2',
        r2Key: 'file.bin',
        ...shareMetadata,
      },
    });
    return { env, token, fileKey };
  }

  it('blocks expired share link', async function () {
    const scenario = await createFileScenario({
      shareExpiresAt: Date.now() - 60_000,
    });

    const response = await invokeV1FileGet(scenario);
    const payload = await parseJson(response);

    assert.strictEqual(response.status, 410);
    assert.strictEqual(payload.success, false);
    assert.strictEqual(payload.error.code, 'FILE_LINK_EXPIRED');
  });

  it('blocks share when max downloads reached', async function () {
    const scenario = await createFileScenario({
      shareMaxDownloads: 1,
      shareDownloadCount: 1,
    });

    const response = await invokeV1FileGet(scenario);
    const payload = await parseJson(response);

    assert.strictEqual(response.status, 410);
    assert.strictEqual(payload.success, false);
    assert.strictEqual(payload.error.code, 'FILE_LINK_EXPIRED');
  });

  it('requires password for protected share', async function () {
    const salt = 'salt123';
    const hash = await sha256Hex(`${salt}:secret-pass`);
    const scenario = await createFileScenario({
      sharePasswordSalt: salt,
      sharePasswordHash: hash,
    });

    const response = await invokeV1FileGet(scenario);
    const payload = await parseJson(response);

    assert.strictEqual(response.status, 401);
    assert.strictEqual(payload.success, false);
    assert.strictEqual(payload.error.code, 'FILE_PASSWORD_REQUIRED');
  });

  it('accepts correct password and increments download counter', async function () {
    const salt = 'salt-ok';
    const password = 'correct-pass';
    const hash = await sha256Hex(`${salt}:${password}`);
    const scenario = await createFileScenario({
      shareMaxDownloads: 5,
      shareDownloadCount: 0,
      sharePasswordSalt: salt,
      sharePasswordHash: hash,
    });

    const response = await invokeV1FileGet({
      ...scenario,
      query: `password=${encodeURIComponent(password)}`,
    });

    assert.strictEqual(response.status, 200);
    const record = await scenario.env.img_url.getWithMetadata(scenario.fileKey);
    assert.strictEqual(Number(record?.metadata?.shareDownloadCount || 0), 1);
  });

  it('serves R2 byte ranges for media previews', async function () {
    const scenario = await createFileScenario();

    const response = await invokeV1FileGet({
      ...scenario,
      headers: { Range: 'bytes=1-2' },
    });

    assert.strictEqual(response.status, 206);
    assert.strictEqual(response.headers.get('Accept-Ranges'), 'bytes');
    assert.strictEqual(response.headers.get('Content-Range'), 'bytes 1-2/4');
    assert.strictEqual(response.headers.get('Content-Length'), '2');

    const body = new Uint8Array(await response.arrayBuffer());
    assert.deepStrictEqual(Array.from(body), [2, 3]);
  });
});
