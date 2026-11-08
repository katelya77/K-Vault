const assert = require('node:assert/strict');

const MiB = 1024 ** 2;
const fileSize = 112 * MiB + 1;
const authorization = 'Basic ' + Buffer.from('test-admin:test-password').toString('base64');

describe('Pages native R2 multipart API', function () {
  let endpoint;
  let authenticate;
  let status;
  let env;
  let uploads;
  let metadata;
  let completed;
  let failIndex;

  before(async function () {
    ({ onRequest: endpoint } = await import('../functions/api/admin/r2-multipart.js'));
    ({ onRequest: authenticate } = await import('../functions/api/admin/_middleware.js'));
    ({ onRequestGet: status } = await import('../functions/api/status.js'));
  });

  beforeEach(function () {
    uploads = new Map();
    metadata = new Map();
    completed = new Map();
    failIndex = false;
    env = {
      BASIC_USER: 'test-admin',
      BASIC_PASS: 'test-password',
      img_url: {
        list: async () => ({ keys: [] }),
        getWithMetadata: async key => metadata.get(key),
        put: async (key, _value, options) => {
          if (failIndex) throw new Error('KV temporarily unavailable');
          metadata.set(key, options);
        },
      },
      R2_BUCKET: {
        list: async () => ({ objects: [] }),
        createMultipartUpload: async (key, options) => {
          uploads.set(key, options);
          return { uploadId: 'test-upload' };
        },
        resumeMultipartUpload(key, uploadId) {
          assert.equal(uploadId, 'test-upload');
          function pending() {
            const upload = uploads.get(key);
            if (!upload) throw new Error('R2 operation failed (10024)');
            return upload;
          }
          return {
            async uploadPart(partNumber, bytes) {
              pending();
              assert.equal(bytes.byteLength, 1);
              return { partNumber, etag: 'trailing-part' };
            },
            async complete(parts) {
              const upload = pending();
              assert.equal(parts.length, 8);
              uploads.delete(key);
              const object = { size: fileSize, customMetadata: upload.customMetadata };
              completed.set(key, object);
              return object;
            },
            async abort() {
              pending();
              uploads.delete(key);
            },
          };
        },
        head: async key => completed.get(key),
      },
    };
  });

  function request(method, { suffix = '', session, body, json, auth = authorization, origin } = {}) {
    const headers = {};
    if (auth) headers.Authorization = auth;
    if (session) headers['X-Upload-Session'] = session;
    if (origin) headers.Origin = origin;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }
    const context = {
      request: new Request(`https://vault.example/api/admin/r2-multipart${suffix}`, { method, headers, body }),
      env,
    };
    return authenticate({ ...context, next: () => endpoint(context) });
  }

  async function begin() {
    const response = await request('POST', { json: { fileName: 'document.bin', fileSize, folderPath: 'docs/old/../new' } });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.partSize, 16 * MiB);
    return payload.session;
  }

  it('requires an authenticated admin and a same-origin request', async function () {
    const json = { fileName: 'large.bin', fileSize };
    assert.equal((await request('POST', { json, auth: '' })).status, 401);
    assert.equal((await request('POST', { json, origin: 'https://other.example' })).status, 403);
    delete env.BASIC_PASS;
    assert.equal((await request('POST', { json })).status, 503);
    assert.equal(uploads.size, 0);
  });

  it('advertises a separate multipart cap without raising the legacy endpoint limit', async function () {
    const limits = (await (await status({ env })).json()).uploadLimits.r2;
    assert.equal(limits.maxBytes, 100 * MiB);
    assert.equal(limits.multipartMaxBytes, 20 * 1024 ** 3);
    delete env.BASIC_PASS;
    assert.equal((await (await status({ env })).json()).uploadLimits.r2.multipartMaxBytes, 0);
  });

  it('validates size, signed session, and exact part length before accepting data', async function () {
    assert.equal((await request('POST', { json: { fileName: 'oversize.bin', fileSize: 20 * 1024 ** 3 + 1 } })).status, 413);
    assert.equal((await request('POST', { json: { fileName: 'legacy.bin', fileSize: 100 * MiB } })).status, 400);
    const session = await begin();
    const send = (part, bytes, token = session) => request('PUT', { suffix: `?part=${part}`, session: token, body: bytes });
    const forged = (session.startsWith('A') ? 'B' : 'A') + session.slice(1);
    assert.equal((await send(8, Uint8Array.of(1), forged)).status, 403);
    assert.equal((await send(9, Uint8Array.of(1))).status, 400);
    assert.equal((await send(8, new Uint8Array())).status, 400);
    assert.equal((await send(8, Uint8Array.of(1, 2))).status, 413);
    assert.deepEqual((await (await send(8, Uint8Array.of(1))).json()).part, { partNumber: 8, etag: 'trailing-part' });
  });

  it('repairs the index after a completion retry and preserves the resulting file on discard', async function () {
    const session = await begin();
    const parts = Array.from({ length: 8 }, (_, index) => ({ partNumber: index + 1, etag: String(index).repeat(171) }));
    const finish = parts => request('POST', { suffix: '?action=complete', session, json: { parts } });
    assert.equal((await finish(parts.slice(0, 7))).status, 400);
    assert.equal(completed.size, 0);
    failIndex = true;
    const unavailable = await finish(parts);
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).error.code, 'INDEX_PENDING');
    assert.equal(completed.size, 1);
    assert.equal(metadata.size, 0);
    failIndex = false;
    const recovered = await (await finish(parts)).json();
    const key = recovered.src.slice('/file/'.length);
    assert.equal(metadata.get(key).metadata.fileSize, fileSize);
    assert.equal(metadata.get(key).metadata.folderPath, 'docs/new');
    metadata.get(key).metadata.ListType = 'Block';
    assert.equal((await (await request('DELETE', { session })).json()).src, recovered.src);
    assert.equal(metadata.get(key).metadata.ListType, 'Block');
    assert.equal(completed.size, 1);
  });

  it('aborts an incomplete upload idempotently and rejects subsequent parts', async function () {
    const session = await begin();
    for (let i = 0; i < 2; i++) {
      assert.equal((await (await request('DELETE', { session })).json()).aborted, true);
    }
    const response = await request('PUT', { suffix: '?part=8', session, body: Uint8Array.of(1) });
    assert.equal(response.status, 410);
    assert.equal(uploads.size, 0);
    assert.equal(metadata.size, 0);
  });
});
