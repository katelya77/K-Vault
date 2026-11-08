const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGalleryPage(status = {}, fetchCalls = []) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'gallery.html'), 'utf8');
  const script = html.match(/<script>\s*(const LOCAL_PREVIEW_PAGE[\s\S]*?)<\/script>/);
  assert.ok(script, 'gallery page script should exist');
  let options;
  vm.runInNewContext(script[1], {
    URL,
    document: { location: { origin: 'https://site-a.example' } },
    fetch: async (url) => {
      fetchCalls.push(url);
      return { ok: true, json: async () => status };
    },
    Vue: function Vue(config) { options = config; },
  });
  const page = Object.assign({}, options.data, options.methods);
  for (const [name, getter] of Object.entries(options.computed)) {
    Object.defineProperty(page, name, { get: () => getter.call(page) });
  }
  page.showToast = () => {};
  return { html, page };
}

describe('Gallery public access links', function () {
  it('enables the public copy button only for a different configured domain', async function () {
    const calls = [];
    const { html, page } = loadGalleryPage({ publicBaseUrl: 'https://images-b.example' }, calls);
    assert.ok(html.includes('复制公共访问链接'));
    assert.ok(html.includes(':disabled="!publicLinkAvailable"'));
    assert.equal(page.publicLinkAvailable, false);
    await page.loadPublicBaseUrl();
    assert.equal(page.publicLinkAvailable, true);
    page.publicBaseUrl = 'https://site-a.example';
    assert.equal(page.publicLinkAvailable, false);
    assert.deepEqual(calls, ['/api/status?view=public-links']);
    page.publicBaseUrl = 'https://site-a.example:8443';
    assert.equal(page.publicLinkAvailable, true);
    page.publicBaseUrl = 'https://site-a.example/cache';
    assert.equal(page.publicLinkAvailable, true);
    page.publicBaseUrl = '';
    assert.equal(page.publicLinkAvailable, false);
  });

  it('copies selected files with the public domain and current link format', async function () {
    const { page } = loadGalleryPage({ publicBaseUrl: 'https://images-b.example' });
    await page.loadPublicBaseUrl();
    page.images = [
      { name: 'first.jpg', selected: true, metadata: { fileName: 'First' } },
      { name: 'second.jpg', selected: false },
      { name: 'third.jpg', selected: true },
    ];
    let copied = '';
    page.copyToClipboard = (value) => { copied = value; };
    page.batchCopyPublicLinks();
    assert.equal(copied, 'https://images-b.example/file/first.jpg\nhttps://images-b.example/file/third.jpg');

    page.linkFormat = 'markdown';
    page.batchCopyPublicLinks();
    assert.equal(copied, '![First](https://images-b.example/file/first.jpg)\n![third.jpg](https://images-b.example/file/third.jpg)');

    page.batchCopy();
    assert.equal(copied, '![First](https://site-a.example/file/first.jpg)\n![third.jpg](https://site-a.example/file/third.jpg)');
  });

  it('reads only public link configuration without probing Pages storage', async function () {
    const { onRequestGet } = await import('../functions/api/status.js');
    const response = await onRequestGet({
      request: new Request('https://site-a.example/api/status?view=public-links'),
      env: {
        PUBLIC_BASE_URL: 'https://images-b.example/cache/',
        get R2_BUCKET() { throw new Error('The public link response must skip storage probes'); },
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { publicBaseUrl: 'https://images-b.example/cache' });
  });

  it('does not copy public links when no different domain is configured', function () {
    const { page } = loadGalleryPage();
    page.images = [{ name: 'first.jpg', selected: true }];
    let copied = false;
    page.copyToClipboard = () => { copied = true; };
    page.batchCopyPublicLinks();
    assert.equal(copied, false);
  });
});
