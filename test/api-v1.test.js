const assert = require('assert');

class MemoryKV {
  constructor() {
    this.store = new Map();
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

    const stat = await env.img_url.get(`token_stat:${tokenInfo.id}`, { type: 'json' });
    assert.ok(Number(stat?.lastUsedAt || 0) > 0);
    const tokenRecord = await env.img_url.get(`api_token:${tokenInfo.id}`, { type: 'json' });
    assert.ok(!tokenRecord || tokenRecord.lastUsedAt == null);
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


describe('API v1 upload folder policy (Pages)', function () {
  it('checks the same canonical folder that is used for the upload', async function () {
    const { onRequestPost: upload } = await import('../functions/api/v1/upload.js');
    const { onRequest: middleware } = await import('../functions/api/v1/_middleware.js');
    const { env, token } = await createEnvAndToken(['upload'], { policies: { folderPrefix: 'blog' } });
    env.disable_telemetry = 'true';

    async function uploadTo(fields, query = '') {
      const form = new FormData();
      form.append('file', new Blob(['image-bytes'], { type: 'image/png' }), 'image.png');
      form.set('storage', 'r2');
      for (const [name, value] of Object.entries(fields)) form.set(name, value);
      const context = {
        request: new Request(`https://example.com/api/v1/upload${query}`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
        }),
        env,
        data: {},
        waitUntil: () => {},
      };
      return middleware({ ...context, next: () => upload({ ...context, next: () => new Response() }) });
    }

    for (const folderPath of ['blog-other', 'blog/../outside', 'blog\\..\\outside']) {
      const response = await uploadTo({ folderPath });
      assert.strictEqual(response.status, 403, folderPath);
      assert.strictEqual((await response.json()).error.code, 'POLICY_FOLDER_DENIED');
      assert.strictEqual(env.R2_BUCKET.objects.size, 0);
    }
    for (const [fields, query, expected] of [
      [{ folderPath: 'blog' }, '', 'blog'],
      [{ folder: 'blog/child' }, '', 'blog/child'],
      [{}, '?folder=blog%2Fquery', 'blog/query'],
    ]) {
      const response = await uploadTo(fields, query);
      assert.strictEqual(response.status, 200);
      const { file } = await response.json();
      assert.strictEqual((await env.img_url.getWithMetadata(file.id)).metadata.folderPath, expected);
    }
  });
});

describe('API v1 import policies and retries (Pages)', function () {
  it('checks the sniffed MIME and replays a successful import without fetching or writing again', async function () {
    const { onRequestPost: importFile } = await import('../functions/api/v1/import.js');
    const { env, tokenInfo } = await createEnvAndToken(['upload'], {
      policies: { allowedMimeTypes: ['image/png'], folderPrefix: 'blog' },
    });
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
      return new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } });
    };
    function run(folder) {
      return importFile({
        env, data: { apiToken: tokenInfo },
        request: new Request('https://example.com/api/v1/import', {
          method: 'POST',
          headers: { 'Idempotency-Key': 'import-cover' },
          body: JSON.stringify({ url: 'https://source.example/image.png', storage: 'r2', folder }),
        }),
      });
    }
    try {
      const denied = await run('blog/../outside');
      assert.strictEqual(denied.status, 403);
      assert.strictEqual((await denied.json()).error.code, 'POLICY_FOLDER_DENIED');
      assert.strictEqual(fetchCalls, 0);
      const first = await run('blog/child');
      assert.strictEqual(first.status, 201);
      const payload = await first.json();
      assert.strictEqual(payload.data.file.mime, 'image/png');
      const second = await run('blog/child');
      assert.strictEqual(second.status, first.status);
      assert.strictEqual(second.headers.get('Idempotency-Replayed'), 'true');
      assert.deepStrictEqual(await second.json(), payload);
      assert.strictEqual(fetchCalls, 1);
      assert.strictEqual(env.R2_BUCKET.objects.size, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('API v1 upload low-KV-write mode', function () {
  function createLowWriteEnv() {
    return {
      img_url: new MemoryKV(),
      R2_BUCKET: new MemoryR2(),
      TG_Bot_Token: 'test-bot-token',
      TG_Chat_ID: '-1001234567890',
      FILE_URL_SECRET: 'test-file-url-secret',
      MINIMIZE_KV_WRITES: 'true',
      TELEGRAM_METADATA_MODE: 'off',
      TG_UPLOAD_NOTIFY: 'false',
      disable_telemetry: 'true',
    };
  }

  function mockTelegramFetch() {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      assert.match(String(url), /\/sendDocument$/);
      return new Response(JSON.stringify({
        ok: true,
        result: { message_id: 42, document: { file_id: 'telegram-image-file-id' } },
      }), { headers: { 'Content-Type': 'application/json' } });
    };
    return () => {
      globalThis.fetch = originalFetch;
    };
  }

  it('replays the original signed Telegram response with no delete link', async function () {
    const { onRequestPost: upload } = await import('../functions/api/v1/upload.js');
    const env = createLowWriteEnv();
    const restoreFetch = mockTelegramFetch();
    function run() {
      const body = new FormData();
      body.append('file', new Blob(['image-bytes'], { type: 'image/png' }), 'image.png');
      return upload({
        request: new Request('https://example.com/api/v1/upload', {
          method: 'POST', headers: { 'Idempotency-Key': 'telegram-upload' }, body,
        }),
        env,
        data: { apiToken: { id: 'test-token' } },
        next: () => new Response(),
      });
    }
    try {
      const first = await run();
      const payload = await first.json();
      assert.strictEqual(first.status, 200);
      assert.strictEqual(payload.links.delete, null);
      const second = await run();
      assert.strictEqual(second.headers.get('Idempotency-Replayed'), 'true');
      assert.deepStrictEqual(await second.json(), payload);
    } finally {
      restoreFetch();
    }
  });

  it('uploads signed Telegram files without metadata KV access when metadata is disabled', async function () {
    const { onRequestPost: upload } = await import('../functions/api/v1/upload.js');
    const env = createLowWriteEnv();

    const formData = new FormData();
    formData.append('file', new Blob(['image-bytes'], { type: 'image/png' }), 'image.png');

    const restoreFetch = mockTelegramFetch();
    try {
      const readsBefore = env.img_url.getWithMetadataCalls;
      const writesBefore = env.img_url.putCalls;
      const response = await upload({
        request: new Request('https://example.com/api/v1/upload', { method: 'POST', body: formData }),
        env,
        data: { apiToken: { id: 'test-token' } },
        next: () => new Response('next', { status: 200 }),
      });
      const payload = await parseJson(response);

      assert.strictEqual(response.status, 200);
      assert.match(payload.links.download, /\/file\/tgs_/);
      assert.strictEqual(payload.links.delete, null);
      assert.strictEqual(env.img_url.getWithMetadataCalls, readsBefore, 'post-upload metadata lookup must be skipped');
      assert.strictEqual(env.img_url.putCalls, writesBefore, 'no KV writes are expected without dedup/idempotency');
    } finally {
      restoreFetch();
    }
  });

  it('ignores Telegram sharing options when metadata is disabled', async function () {
    const { onRequestPost: upload } = await import('../functions/api/v1/upload.js');
    const env = createLowWriteEnv();

    const formData = new FormData();
    formData.append('file', new Blob(['image-bytes'], { type: 'image/png' }), 'image.png');
    formData.append('password', 'secret');
    formData.append('expires_in', '86400');
    formData.append('max_downloads', '3');
    formData.append('slug', 'ignored-share-link');

    const restoreFetch = mockTelegramFetch();
    try {
      const readsBefore = env.img_url.getWithMetadataCalls;
      const writesBefore = env.img_url.putCalls;
      const response = await upload({
        request: new Request('https://example.com/api/v1/upload', { method: 'POST', body: formData }),
        env,
        data: { apiToken: { id: 'test-token' } },
        next: () => new Response('next', { status: 200 }),
      });
      const payload = await parseJson(response);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(payload.links.delete, null);
      assert.strictEqual(env.img_url.getWithMetadataCalls, readsBefore, 'metadata lookup must be skipped');
      assert.strictEqual(env.img_url.putCalls, writesBefore, 'sharing options must not trigger KV writes');
    } finally {
      restoreFetch();
    }
  });
});
