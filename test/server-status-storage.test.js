const assert = require('assert');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../server/app');

describe('Server status storage semantics', function () {
  this.timeout(10000);

  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  let tmpDir;

  beforeEach(function () {
    tmpDir = path.join(__dirname, '..', 'data', `tmp-status-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    process.env.CONFIG_ENCRYPTION_KEY = 'status_test_key_123456';
    process.env.SESSION_SECRET = 'status_test_secret_123456';
    process.env.DATA_DIR = tmpDir;
    process.env.DB_PATH = path.join(tmpDir, 'status-test.db');
    process.env.TG_BOT_TOKEN = '';
    process.env.TG_CHAT_ID = '';
    process.env.HF_TOKEN = '';
    process.env.HF_REPO = '';
    process.env.HUGGINGFACE_TOKEN = '';
    process.env.HUGGINGFACE_REPO = '';
    process.env.HF_API_TOKEN = '';
    process.env.HF_DATASET_REPO = '';

    process.env.GITHUB_TOKEN = 'bad_token';
    process.env.GITHUB_REPO = 'owner/repo';
    process.env.GH_TOKEN = '';
    process.env.GITHUB_PAT = '';
    process.env.GH_REPO = '';
    process.env.GITHUB_REPOSITORY = '';

    global.fetch = async () => new Response(
      JSON.stringify({ message: 'Bad credentials' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    process.env.SETTINGS_STORE = 'sqlite';
    process.env.SETTINGS_REDIS_URL = '';
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

    global.fetch = originalFetch;

    // Some SQLite handles can still be held briefly by the runtime container.
    // Keep temp files to avoid flaky EBUSY on Windows CI/dev boxes.
  });

  it('keeps enabled=true when storage is configured but connection fails', async function () {
    const app = createApp();

    const statusResponse = await app.fetch(new Request('http://localhost/api/status'));
    assert.strictEqual(statusResponse.status, 200);

    const status = await statusResponse.json();
    assert.ok(status.github);
    assert.strictEqual(status.github.configured, true);
    assert.strictEqual(status.github.connected, false);
    assert.strictEqual(status.github.enabled, true);
  });
});
