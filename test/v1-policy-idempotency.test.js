const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { createApp } = require('../server/app');
const { initDatabase } = require('../server/db');
const { loadConfig } = require('../server/lib/config');
const { FileRepository } = require('../server/lib/repos/file-repo');
const { StorageConfigRepository } = require('../server/lib/repos/storage-config-repo');

describe('API v1 token policies, idempotency and dedup (Docker)', function () {
  const originalEnv = { ...process.env };
  let tmpDir;
  let app;
  let authHeader;

  beforeEach(function () {
    tmpDir = path.join(__dirname, '..', 'data', `tmp-policy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    process.env.CONFIG_ENCRYPTION_KEY = 'policy_key_123456';
    process.env.SESSION_SECRET = 'policy_secret_123456';
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'policy.db');
    process.env.BASIC_USER = 'admin';
    process.env.BASIC_PASS = 'secret123';
    process.env.TG_BOT_TOKEN = '';
    process.env.TG_CHAT_ID = '';
    process.env.DEFAULT_STORAGE_TYPE = 'telegram';
    process.env.API_CORS_ORIGINS = '';

    authHeader = `Basic ${Buffer.from('admin:secret123').toString('base64')}`;
    app = createApp();
  });

  afterEach(function () {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
  });

  async function createToken(policies) {
    const response = await app.fetch(new Request('http://localhost/api/admin/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ name: 'policy-bot', scopes: ['upload'], policies }),
    }));
    assert.strictEqual(response.status, 201);
    const payload = await response.json();
    return payload.token;
  }

  function uploadRequest(token, { content = 'hello', storage = 'telegram', storageId = '', folderPath = '', idempotencyKey = '', password = '' } = {}) {
    const form = new FormData();
    form.append('file', new Blob([content], { type: 'image/png' }), 'hello.png');
    if (storage) form.append('storage', storage);
    if (storageId) form.append('storageId', storageId);
    if (folderPath) form.append('folderPath', folderPath);
    if (password) form.append('password', password);
    const headers = { Authorization: `Bearer ${token}` };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    return app.fetch(new Request('http://localhost/api/v1/upload', {
      method: 'POST',
      headers,
      body: form,
    }));
  }

  it('blocks uploads to storages outside allowedStorages', async function () {
    const token = await createToken({ allowedStorages: ['r2'] });
    const response = await uploadRequest(token, { storage: 'telegram' });
    const payload = await response.json();
    assert.strictEqual(response.status, 403);
    assert.strictEqual(payload.error?.code, 'POLICY_DENIED');
    assert.deepStrictEqual(payload.error?.allowedStorages, ['r2']);
  });

  it('enforces allowedStorages on the resolved backend, including default and ID selection', async function () {
    const db = initDatabase(process.env.DB_PATH);
    const storageRepo = new StorageConfigRepository(db, loadConfig(process.env));
    const telegram = storageRepo.create({
      name: 'Telegram Default', type: 'telegram',
      config: { botToken: 'test-token', chatId: 'test-chat' },
      isDefault: true,
    });
    const token = await createToken({ allowedStorages: ['r2'] });
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('Policy denial must happen before storage access');
    };
    try {
      for (const options of [
        { storage: '' },
        { storage: 'r2' },
        { storage: 'r2', storageId: telegram.id },
      ]) {
        const response = await uploadRequest(token, options);
        assert.strictEqual(response.status, 403, JSON.stringify(options));
        assert.strictEqual((await response.json()).error.code, 'POLICY_DENIED');
      }
      assert.strictEqual(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('blocks imports that would fall back to a disallowed backend', async function () {
    const db = initDatabase(process.env.DB_PATH);
    const storageRepo = new StorageConfigRepository(db, loadConfig(process.env));
    storageRepo.create({
      name: 'Telegram Default', type: 'telegram',
      config: { botToken: 'test-token', chatId: 'test-chat' },
      isDefault: true,
    });
    const token = await createToken({ allowedStorages: ['r2'] });
    const originalFetch = globalThis.fetch;
    const source = 'https://8.8.8.8/image.png';
    let backendCalls = 0;
    globalThis.fetch = async (url) => {
      if (String(url) !== source) {
        backendCalls += 1;
        throw new Error('Policy denial must happen before storage access');
      }
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
      return new Response(bytes, { headers: { 'Content-Type': 'image/png' } });
    };
    try {
      const response = await app.fetch(new Request('http://localhost/api/v1/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: source, storage: 'r2' }),
      }));
      assert.strictEqual(response.status, 403);
      assert.strictEqual((await response.json()).error.code, 'POLICY_DENIED');
      assert.strictEqual(backendCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('blocks uploads outside the folderPrefix policy', async function () {
    const token = await createToken({ folderPrefix: 'agent-uploads' });
    const response = await uploadRequest(token, { folderPath: 'other' });
    const payload = await response.json();
    assert.strictEqual(response.status, 403);
    assert.strictEqual(payload.error?.code, 'POLICY_DENIED');
  });

  it('returns 413 when the file exceeds the token maxFileSize policy', async function () {
    const token = await createToken({ maxFileSize: 2 });
    const response = await uploadRequest(token, { content: 'toolarge' });
    const payload = await response.json();
    assert.strictEqual(response.status, 413);
    assert.strictEqual(payload.error?.code, 'POLICY_FILE_TOO_LARGE');
  });

  it('rejects invalid policies at creation', async function () {
    const response = await app.fetch(new Request('http://localhost/api/admin/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({
        name: 'bad-policy',
        scopes: ['upload'],
        policies: { allowedStorages: ['dropbox'] },
      }),
    }));
    const payload = await response.json();
    assert.strictEqual(response.status, 400);
    assert.strictEqual(payload.error?.code, 'INVALID_POLICY');
  });

  it('replays the same response for a repeated Idempotency-Key', async function () {
    const token = await createToken(null);
    const content = 'idem-content-bytes';
    const sha = crypto.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');

    // Pre-seed the SHA-256 dedup index so the first upload resolves without a
    // real storage backend (Requirement #11); the dedup response is then cached
    // and replayed on the second request carrying the same Idempotency-Key.
    const db = initDatabase(process.env.DB_PATH);
    const config = loadConfig(process.env);
    const storageRepo = new StorageConfigRepository(db, config);
    const storage = storageRepo.create({
      name: 'Telegram Idem',
      type: 'telegram',
      config: { botToken: 'token', chatId: 'chat' },
      enabled: true,
      isDefault: true,
    });
    const fileRepo = new FileRepository(db);
    fileRepo.create({
      id: 'idem-original.png',
      storageConfigId: storage.id,
      storageType: 'telegram',
      storageKey: 'idem-original',
      fileName: 'idem-original.png',
      fileSize: Buffer.byteLength(content),
      mimeType: 'image/png',
      extra: { shareSlug: 'idem-share' },
    });
    db.prepare('INSERT INTO sha_dedup_index(sha256, file_id, file_name, storage_type, file_size, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sha, 'idem-original.png', 'idem-original.png', 'telegram', Buffer.byteLength(content), Date.now(), Date.now() + 86400000);

    const first = await uploadRequest(token, { content, idempotencyKey: 'op-1' });
    assert.strictEqual(first.status, 200);
    const firstPayload = await first.json();
    assert.ok(firstPayload.success);
    const firstFileId = firstPayload.file?.id;
    assert.strictEqual(firstFileId, 'idem-original.png');

    const second = await uploadRequest(token, { content, idempotencyKey: 'op-1' });
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.headers.get('idempotency-replayed'), 'true');
    const secondPayload = await second.json();
    assert.strictEqual(secondPayload.file?.id, firstFileId);
  });

  it('deduplicates identical small uploads through the SHA-256 index', async function () {
    const token = await createToken(null);
    const content = 'dedup-content-bytes';
    const sha = crypto.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');

    const db = initDatabase(process.env.DB_PATH);
    const config = loadConfig(process.env);
    const storageRepo = new StorageConfigRepository(db, config);
    const storage = storageRepo.create({
      name: 'Telegram Test',
      type: 'telegram',
      config: { botToken: 'token', chatId: 'chat' },
      enabled: true,
      isDefault: true,
    });
    const fileRepo = new FileRepository(db);
    fileRepo.create({
      id: 'dedup-original.png',
      storageConfigId: storage.id,
      storageType: 'telegram',
      storageKey: 'dedup-original',
      fileName: 'dedup-original.png',
      fileSize: Buffer.byteLength(content),
      mimeType: 'image/png',
      extra: { shareSlug: 'dedup-share' },
    });
    db.prepare('INSERT INTO sha_dedup_index(sha256, file_id, file_name, storage_type, file_size, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sha, 'dedup-original.png', 'dedup-original.png', 'telegram', Buffer.byteLength(content), Date.now(), Date.now() + 86400000);

    const response = await uploadRequest(token, { content });
    assert.strictEqual(response.status, 200);
    const payload = await response.json();
    assert.strictEqual(payload.deduplicated, true);
    assert.strictEqual(payload.file?.id, 'dedup-original.png');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      assert.match(String(url), /\/sendDocument$/);
      return Response.json({ ok: true, result: { message_id: 42, document: { file_id: 'dedup-protected' } } });
    };
    try {
      const response = await uploadRequest(token, { content, password: 'fixture-share' });
      assert.strictEqual(response.status, 200);
      const protectedUpload = await response.json();
      assert.notStrictEqual(protectedUpload.file.id, 'dedup-original.png');
      assert.strictEqual((await app.request(protectedUpload.links.download)).status, 401);
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.ok(payload.links?.download);
  });
});
