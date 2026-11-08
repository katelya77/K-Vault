const assert = require('node:assert/strict');

describe('API v1 storage capabilities across Pages and Docker', function () {
  let detectConfiguredStorages;
  let onRequestGet;

  before(async function () {
    ({ detectConfiguredStorages, onRequestGet } = await import('../functions/api/v1/capabilities.js'));
  });

  it('detects mixed-case Telegram bindings used by existing Cloudflare Pages deployments', async function () {
    const env = {
      TG_Bot_Token: 'example-pages-bot-token',
      TG_Chat_ID: '-1001234567890',
      R2_BUCKET: { get() {} },
    };
    assert.deepEqual(detectConfiguredStorages(env), ['telegram', 'r2']);
    const response = await onRequestGet({ env });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.deepEqual(body.data.storages, ['telegram', 'r2']);
  });

  it('keeps detecting normalized Docker Telegram bindings', function () {
    assert.deepEqual(detectConfiguredStorages({
      TG_BOT_TOKEN: 'example-docker-bot-token',
      TG_CHAT_ID: '-1001234567890',
    }), ['telegram']);
  });

  it('accepts both supported variable naming conventions together', function () {
    assert.deepEqual(detectConfiguredStorages({
      TG_BOT_TOKEN: 'example-bot-token',
      TG_Chat_ID: '-1001234567890',
    }), ['telegram']);
  });

  it('does not report Telegram if either credential is absent', function () {
    assert.deepEqual(detectConfiguredStorages({ TG_Bot_Token: 'example-bot-token' }), []);
    assert.deepEqual(detectConfiguredStorages({ TG_Chat_ID: '-1001234567890' }), []);
    assert.deepEqual(detectConfiguredStorages({
      TG_Bot_Token: '  ',
      TG_Chat_ID: '-1001234567890',
    }), []);
  });
});
