const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const dns = require('node:dns').promises;
const { isPrivateHost } = require('../server/lib/utils/ssrf-shared');
const { assertSafeRemoteUrl } = require('../server/lib/utils/ssrf-guard');
const { createApp } = require('../server/app');

describe('SSRF shared host classification', function () {
  const privateTargets = [
    '10.0.0.1',
    '10.255.255.255',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.20.1.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1',
    '100.127.255.255',
    '0.0.0.0',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    'fe80::1',
    'fc00::1',
    'localhost',
    'metadata.google.internal',
  ];

  const publicTargets = [
    '8.8.8.8',
    '::ffff:808:808',
    '1.1.1.1',
    '172.32.0.1',
    '100.128.0.1',
    'example.com',
  ];

  for (const host of privateTargets) {
    it(`classifies ${host} as private`, function () {
      assert.strictEqual(isPrivateHost(host), true, host);
    });
  }

  for (const host of publicTargets) {
    it(`classifies ${host} as public`, function () {
      assert.strictEqual(isPrivateHost(host), false, host);
    });
  }

  it('resolves single-label Docker hosts before allowing a fetch', async function () {
    const lookup = dns.lookup;
    dns.lookup = async (hostname) => {
      assert.strictEqual(hostname, 'internalservice');
      return [{ address: '10.1.2.3', family: 4 }];
    };
    try {
      const result = await assertSafeRemoteUrl('http://internalservice/image.png');
      assert.strictEqual(result.code, 'SSRF_BLOCKED');
    } finally {
      dns.lookup = lookup;
    }
  });
});

describe('API v1 import SSRF protection (Docker)', function () {
  const originalEnv = { ...process.env };
  let tmpDir;
  let app;
  let token;

  beforeEach(async function () {
    tmpDir = path.join(__dirname, '..', 'data', `tmp-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    process.env.CONFIG_ENCRYPTION_KEY = 'import_key_123456';
    process.env.SESSION_SECRET = 'import_secret_123456';
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'import.db');
    process.env.BASIC_USER = 'admin';
    process.env.BASIC_PASS = 'secret123';
    process.env.TG_BOT_TOKEN = '';
    process.env.TG_CHAT_ID = '';
    process.env.DEFAULT_STORAGE_TYPE = 'telegram';
    process.env.API_CORS_ORIGINS = '';

    const authHeader = `Basic ${Buffer.from('admin:secret123').toString('base64')}`;
    app = createApp();
    const createResponse = await app.fetch(new Request('http://localhost/api/admin/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ name: 'import-bot', scopes: ['upload'] }),
    }));
    assert.strictEqual(createResponse.status, 201);
    const payload = await createResponse.json();
    token = payload.token;
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

  const blockedUrls = [
    'http://127.0.0.1:8080/x.jpg',
    'http://10.1.2.3/x.jpg',
    'http://169.254.169.254/latest/meta-data/',
    'http://172.16.0.9/x.jpg',
    'http://192.168.1.1/x.jpg',
    'http://100.64.0.1/x.jpg',
    'http://localhost/x.jpg',
    'http://metadata.google.internal/computeMetadata/v1/',
  ];

  for (const target of blockedUrls) {
    it(`blocks import of ${target}`, async function () {
      const response = await app.fetch(new Request('http://localhost/api/v1/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: target, storage: 'telegram' }),
      }));
      const payload = await response.json();
      assert.ok(response.status === 403 || response.status === 400, `${target} -> ${response.status}`);
      assert.ok(!payload.success);
    });
  }

  it('rejects non-http(s) protocols', async function () {
    const response = await app.fetch(new Request('http://localhost/api/v1/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url: 'ftp://example.com/x.jpg', storage: 'telegram' }),
    }));
    assert.ok(response.status === 400 || response.status === 403);
  });

  it('requires the url field', async function () {
    const response = await app.fetch(new Request('http://localhost/api/v1/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ storage: 'telegram' }),
    }));
    assert.strictEqual(response.status, 400);
  });

  it('rejects unknown storage backends with the allowed list', async function () {
    const response = await app.fetch(new Request('http://localhost/api/v1/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url: 'http://localhost/x.jpg', storage: 'dropbox' }),
    }));
    const payload = await response.json();
    assert.strictEqual(response.status, 400);
    assert.strictEqual(payload.error?.code, 'INVALID_STORAGE');
    assert.ok(Array.isArray(payload.error?.allowedStorages));
  });
});
