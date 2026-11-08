const assert = require('node:assert/strict');

describe('Pages URL upload routing', function () {
  const telegramLimit = 20 * 1024 * 1024;
  let upload;

  before(async function () {
    ({ onRequestPost: upload } = await import('../functions/api/upload-from-url.js'));
  });

  async function importFile(size, { storageMode, withR2 = true } = {}) {
    const calls = [];
    const records = new Map();
    const source = 'https://source.example/archive.zip';
    const env = {
      TG_Bot_Token: 'test-bot',
      TG_Chat_ID: 'test-chat',
      TG_UPLOAD_NOTIFY: 'false',
      img_url: { put: async (key, _value, { metadata }) => records.set(key, metadata) },
    };
    if (withR2) {
      env.R2_BUCKET = { put: async (_key, data) => {
        assert.equal(data.byteLength, size);
        calls.push('r2');
      } };
    }
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url) === source) {
        return {
          ok: true,
          headers: new Headers({ 'Content-Type': 'application/zip' }),
          arrayBuffer: async () => new ArrayBuffer(size),
        };
      }
      assert.match(String(url), /\/sendDocument$/);
      calls.push('telegram');
      return Response.json({ ok: true, result: { document: { file_id: 'telegram-test-file' } } });
    };
    try {
      const response = await upload({
        env,
        request: new Request('https://vault.example/api/upload-from-url', {
          method: 'POST',
          body: JSON.stringify({ url: source, storageMode, folderPath: 'imports' }),
        }),
      });
      return { response, body: await response.json(), calls, records };
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  it('automatically stores Telegram URL imports over 20 MiB in the configured R2 bucket', async function () {
    const { response, body, calls, records } = await importFile(telegramLimit + 1, { storageMode: 'telegram' });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ['r2']);
    assert.match(body[0].src, /^\/file\/r2:/);
    const record = records.get(body[0].src.slice('/file/'.length));
    assert.equal(record.storageType, 'r2');
    assert.equal(record.folderPath, 'imports');
    assert.equal(record.fileSize, telegramLimit + 1);
  });

  it('keeps the default Telegram route at the 20 MiB boundary', async function () {
    const { response, body, calls } = await importFile(telegramLimit);
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ['telegram']);
    assert.equal(body[0].src, '/file/telegram-test-file.zip');
  });

  it('keeps explicit storage selection and both existing size limits', async function () {
    for (const [size, options] of [
      [telegramLimit + 1, { withR2: false }],
      [26 * 1024 * 1024, { storageMode: 'discord' }],
      [100 * 1024 * 1024 + 1, {}],
    ]) {
      const { response, calls } = await importFile(size, options);
      assert.equal(response.status, 413);
      assert.deepEqual(calls, []);
    }
  });
});
