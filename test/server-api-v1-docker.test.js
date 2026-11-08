const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../server/app');
const { initDatabase } = require('../server/db');
const { loadConfig } = require('../server/lib/config');
const { FileRepository } = require('../server/lib/repos/file-repo');
const { StorageConfigRepository } = require('../server/lib/repos/storage-config-repo');

describe('Docker runtime API v1 parity', function () {
  const originalEnv = { ...process.env };
  let tmpDir;

  beforeEach(function () {
    tmpDir = path.join(__dirname, '..', 'data', `tmp-docker-api-v1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    process.env.CONFIG_ENCRYPTION_KEY = 'docker_api_v1_key_123456';
    process.env.SESSION_SECRET = 'docker_api_v1_secret_123456';
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'docker-api-v1.db');
    process.env.BASIC_USER = '';
    process.env.BASIC_PASS = '';
    process.env.TG_BOT_TOKEN = '';
    process.env.TG_CHAT_ID = '';
    process.env.DEFAULT_STORAGE_TYPE = 'telegram';
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

  async function expectStatus(response, status) {
    if (response.status !== status) {
      throw new Error(`Expected ${status}, got ${response.status}: ${await response.text()}`);
    }
  }

  it('creates admin API tokens and uses them for paste endpoints', async function () {
    // Requirement #1: the admin API fails closed when auth is unconfigured;
    // this legacy parity test now authenticates like a real admin client.
    process.env.BASIC_USER = 'admin';
    process.env.BASIC_PASS = 'docker-parity-pass';
    const adminAuth = `Basic ${Buffer.from('admin:docker-parity-pass').toString('base64')}`;
    const app = createApp();

    const createTokenResponse = await app.fetch(new Request('http://localhost/api/admin/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: adminAuth },
      body: JSON.stringify({ name: 'smoke', scopes: ['paste', 'read', 'delete'] }),
    }));
    await expectStatus(createTokenResponse, 201);
    const createTokenPayload = await createTokenResponse.json();
    assert.ok(createTokenPayload.token);

    const token = createTokenPayload.token;
    const createPasteResponse = await app.fetch(new Request('http://localhost/api/v1/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content: 'hello docker api', language: 'text' }),
    }));
    await expectStatus(createPasteResponse, 201);
    const pastePayload = await createPasteResponse.json();
    assert.ok(pastePayload.paste.id);

    const listResponse = await app.fetch(new Request('http://localhost/api/v1/pastes', {
      headers: { Authorization: `Bearer ${token}` },
    }));
    await expectStatus(listResponse, 200);
    const listPayload = await listResponse.json();
    assert.strictEqual(listPayload.pastes.length, 1);

    const getResponse = await app.fetch(new Request(`http://localhost/api/v1/paste/${pastePayload.paste.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    }));
    await expectStatus(getResponse, 200);
    const getPayload = await getResponse.json();
    assert.strictEqual(getPayload.paste.content, 'hello docker api');

    const deleteResponse = await app.fetch(new Request(`http://localhost/api/v1/paste/${pastePayload.paste.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }));
    await expectStatus(deleteResponse, 200);
  });

  it('redirects /s/:slug to the matching file id and preserves query params', async function () {
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
      id: 'sample-file.txt',
      storageConfigId: storage.id,
      storageType: 'telegram',
      storageKey: 'sample-file',
      fileName: 'sample-file.txt',
      fileSize: 12,
      mimeType: 'text/plain',
      extra: { shareSlug: 'public-sample' },
    });

    const app = createApp();
    const response = await app.fetch(new Request('http://localhost/s/public-sample?password=secret'));

    assert.strictEqual(response.status, 302);
    assert.strictEqual(
      response.headers.get('location'),
      'http://localhost/file/sample-file.txt?password=secret'
    );
  });

  it('protects direct, signed Telegram and legacy signed downloads with the same browser password', async function () {
    const { createShareSignature } = require('../server/lib/utils/share-link');
    const { createSignedTelegramFileId } = require('../server/lib/utils/telegram-webhook');
    const db = initDatabase(process.env.DB_PATH);
    const config = loadConfig(process.env);
    const storageRepo = new StorageConfigRepository(db, config);
    const storage = storageRepo.create({
      name: 'Fixture Telegram', type: 'telegram', config: { botToken: 'fixture-token', chatId: 'chat' },
      enabled: true, isDefault: true,
    });
    const fileRepo = new FileRepository(db);
    const fileId = 'sample-file';
    const id = `${fileId}.txt`;
    fileRepo.create({
      id, storageConfigId: storage.id, storageType: 'telegram', storageKey: fileId,
      fileName: id, fileSize: 12, mimeType: 'text/plain', extra: { shareSlug: 'sample' },
    });

    const origin = 'http://localhost';
    const direct = `/file/${id}`;
    const alias = '/file/' + createSignedTelegramFileId({ fileId, fileExtension: 'txt' }, {
      FILE_URL_SECRET: config.configEncryptionKey,
    });
    const expiresAt = Date.now() + 60_000;
    const signature = createShareSignature({ fileId: id, expiresAt, secret: config.sessionSecret });
    const legacy = `/share/${id}?exp=${expiresAt}&sig=${signature}`;
    const password = 'fixture-share+password';
    const adminRequest = (value, auth = {}) => new Request(origin + '/api/admin/share-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ id, password: value }),
    });

    assert.strictEqual((await createApp().fetch(adminRequest(password))).status, 503);
    process.env.BASIC_USER = 'admin';
    process.env.BASIC_PASS = 'docker-parity-pass';
    const auth = { Authorization: `Basic ${Buffer.from('admin:docker-parity-pass').toString('base64')}` };
    const app = createApp();
    assert.strictEqual((await app.fetch(adminRequest(password))).status, 401);
    assert.strictEqual((await app.fetch(adminRequest(password, auth))).status, 200);
    assert.strictEqual(fileRepo.getById(id).metadata.shareSlug, 'sample');
    const { keys } = await (await app.request(origin + '/api/manage/list', { headers: auth })).json();
    assert.strictEqual(keys[0].metadata.sharePasswordProtected, true);
    assert.ok(!('sharePasswordHash' in keys[0].metadata) && !('sharePasswordSalt' in keys[0].metadata));

    const tokenResponse = await app.request(origin + '/api/admin/tokens', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ name: 'fixture-read', scopes: ['read'] }),
    });
    const { token } = await tokenResponse.json();
    assert.strictEqual(tokenResponse.status, 201);
    const apiPath = `/api/v1/file/${id}`;

    const originalFetch = globalThis.fetch;
    let upstreamCalls = 0;
    globalThis.fetch = async (url, options) => {
      upstreamCalls += 1;
      if (String(url).includes('/getFile')) return Response.json({ ok: true, result: { file_path: 'files/fixture.txt' } });
      if (new Headers(options?.headers).has('range')) {
        return new Response('fixt', { status: 206, headers: { 'Content-Range': 'bytes 0-3/12' } });
      }
      return new Response('fixture-file');
    };
    const read = (path, options) => app.request(origin + path, options);
    const submit = (path, value) => read(path, {
      method: 'POST', headers: { Accept: 'text/html' }, body: new URLSearchParams({ password: value }),
    });
    try {
      assert.strictEqual((await read('/s/sample')).headers.get('Location'), origin + direct);
      for (const path of [direct, alias, legacy]) {
        const prompt = await read(path, { headers: { Accept: 'text/html' } });
        assert.strictEqual(prompt.status, 401);
        assert.match(await prompt.text(), /<form method="post">/);
        assert.strictEqual((await read(path, { method: 'HEAD' })).status, 401);
        assert.strictEqual((await read(path, { headers: { Range: 'bytes=0-3' } })).status, 401);
        assert.strictEqual((await submit(path, 'incorrect')).status, 403);
      }
      const denied = await read(apiPath, { headers: { Authorization: `Bearer ${token}`, Accept: 'text/html' } });
      assert.strictEqual(denied.status, 401);
      assert.strictEqual((await denied.json()).error.code, 'FILE_PASSWORD_REQUIRED');
      assert.strictEqual(upstreamCalls, 0);

      for (const path of [direct, alias, legacy]) {
        const response = await submit(path, password);
        assert.strictEqual(response.status, 200);
        assert.match(response.headers.get('Content-Disposition'), /^attachment/);
        assert.match(response.headers.get('Cache-Control'), /no-store/);
        assert.strictEqual(await response.text(), 'fixture-file');
      }
      const range = await read(apiPath, {
        headers: { Authorization: `Bearer ${token}`, Range: 'bytes=0-3', 'X-File-Password': password },
      });
      assert.strictEqual(range.status, 206);
      assert.strictEqual(await range.text(), 'fixt');
      assert.strictEqual((await read(legacy.replace(signature, 'invalid'))).status, 403);

      assert.strictEqual((await app.fetch(adminRequest(null, auth))).status, 200);
      assert.strictEqual((await read(direct)).status, 200);
      assert.strictEqual((await read(legacy)).status, 200);
      assert.strictEqual((await read(alias)).status, 200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('moves files by stable id or unique display name without changing public links', async function () {
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
      id: 'telegram-stable-id',
      storageConfigId: storage.id,
      storageType: 'telegram',
      storageKey: 'telegram-stable-id',
      fileName: 'photo-display-name.webp',
      fileSize: 12,
      mimeType: 'image/webp',
    });

    const app = createApp();
    const moveResponse = await app.fetch(new Request('http://localhost/api/manage/files/move-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [{ fileName: 'photo-display-name.webp' }],
        targetFolderPath: '图片',
      }),
    }));
    await expectStatus(moveResponse, 200);
    const movePayload = await moveResponse.json();
    assert.strictEqual(movePayload.moved, 1);

    const moved = fileRepo.getById('telegram-stable-id');
    assert.strictEqual(moved.metadata.folderPath, '图片');
    assert.strictEqual(moved.id, 'telegram-stable-id');
    assert.strictEqual(`/file/${moved.id}`, '/file/telegram-stable-id');

    const foldersResponse = await app.fetch(new Request('http://localhost/api/manage/folders'));
    await expectStatus(foldersResponse, 200);
    const foldersPayload = await foldersResponse.json();
    assert.ok(foldersPayload.folders.some((folder) => folder.path === '图片'));
  });

  it('rejects folder moves when no requested files can be resolved', async function () {
    const app = createApp();
    const moveResponse = await app.fetch(new Request('http://localhost/api/manage/files/move-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: ['missing-file-id'],
        targetFolderPath: '图片',
      }),
    }));

    await expectStatus(moveResponse, 404);
    const payload = await moveResponse.json();
    assert.strictEqual(payload.success, false);
    assert.match(payload.error, /没有找到可移动的文件/);
  });
});
