const assert = require('node:assert/strict');

describe('Cloudflare Pages public file URL encoding', function () {
  let onRequest;
  before(async function () { ({ onRequest } = await import('../functions/file/[id].js')); });

  function context(id) {
    const objectKey = 'r2_test.png';
    const bytes = Uint8Array.from([137, 80, 78, 71]);
    return {
      params: { id },
      request: new Request('https://media.katelya.top/file/' + id, { headers: { Range: 'bytes=0-1023' } }),
      env: {
        img_url: {
          async getWithMetadata(key) {
            return key === 'r2:' + objectKey ? { metadata: { fileName: 'test.png', storageType: 'r2', r2Key: objectKey } } : { metadata: null };
          },
        },
        R2_BUCKET: {
          async head(key) { assert.equal(key, objectKey); return { size: bytes.length }; },
          async get(key) { assert.equal(key, objectKey); return { size: bytes.length, body: bytes }; },
        },
      },
    };
  }

  for (const id of ['r2%3Ar2_test.png', 'r2:r2_test.png']) {
    it('reads a ' + (id.includes('%') ? 'percent-encoded' : 'literal-colon') + ' R2 file URL', async function () {
      const response = await onRequest(context(id));
      assert.equal(response.status, 206);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), Uint8Array.from([137, 80, 78, 71]));
    });
  }

  it('rejects malformed URL encoding without uncaught exceptions', async function () {
    const response = await onRequest(context('r2%ZZr2_test.png'));
    assert.equal(response.status, 400);
  });
});
