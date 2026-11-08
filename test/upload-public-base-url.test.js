const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadUploadPage(savedHistory = [], fetchImpl, onDownload) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const script = html.match(/<script>\s*(const LOCAL_PREVIEW_PAGE[\s\S]*?)<\/script>/);
  assert.ok(script, 'upload page script should exist');
  let options;
  const storage = new Map([['uploadHistory', JSON.stringify(savedHistory)]]);
  vm.runInNewContext(script[1], {
    URL,
    URLSearchParams,
    document: {
      location: { origin: 'https://site-a.example' },
      createElement() { return { click() { onDownload?.(this.href); } }; },
    },
    fetch: fetchImpl,
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, value); },
    },
    Vue: function Vue(config) { options = config; },
  });
  return Object.assign({}, options.data, options.methods);
}

describe('Upload result public domain option', function () {
  it('uses the current site for an old URL with no checkbox selection metadata', function () {
    const page = loadUploadPage();
    const savedFile = {
      name: 'picture.jpg',
      url: 'https://images-b.example/file/r2:r2_picture.jpg',
      path: '/file/r2:r2_picture.jpg',
    };
    page.uploadedFiles.push(savedFile);

    assert.equal(page.formatLink(savedFile), 'https://site-a.example/file/r2:r2_picture.jpg');
    assert.equal(page.getBatchLinks(), page.formatLink(savedFile));
  });

  it('repairs saved history using its selected public domain', function () {
    const page = loadUploadPage([{
      name: 'picture.jpg',
      fileName: 'picture.jpg',
      url: 'https://site-a.example/file/r2:r2_picture.jpg',
      path: '/file/r2:r2_picture.jpg',
      linkBaseURL: 'https://images-b.example',
    }]);

    page.loadHistory();
    assert.equal(page.uploadHistory[0].usedPublicBaseUrl, true);
    assert.equal(page.uploadHistory[0].url, 'https://images-b.example/file/r2:r2_picture.jpg');
    assert.equal(page.formatLink(page.uploadHistory[0]), page.uploadHistory[0].url);
  });

  it('uses PUBLIC_BASE_URL only for results uploaded with the checkbox selected', function () {
    const page = loadUploadPage();
    page.publicBaseUrl = 'https://images-b.example';
    page.usePublicBaseUrl = true;

    const selectedContext = page.createUploadContext();
    const selectedItem = {
      file: { name: 'picture.jpg', size: 123 },
      linkBaseURL: selectedContext.linkBaseURL,
      usedPublicBaseUrl: selectedContext.usedPublicBaseUrl,
    };
    page.handleUploadSuccess(selectedItem, '/file/r2:r2_picture.jpg');
    assert.equal(page.uploadedFiles[0].usedPublicBaseUrl, true);
    assert.equal(page.uploadHistory[0].usedPublicBaseUrl, true);
    assert.equal(page.formatLink(page.uploadedFiles[0]), 'https://images-b.example/file/r2:r2_picture.jpg');

    page.usePublicBaseUrl = false;
    const defaultContext = page.createUploadContext();
    const defaultItem = {
      file: { name: 'other.jpg', size: 456 },
      linkBaseURL: defaultContext.linkBaseURL,
      usedPublicBaseUrl: defaultContext.usedPublicBaseUrl,
    };
    page.handleUploadSuccess(defaultItem, '/file/r2:r2_other.jpg');
    assert.equal(page.uploadedFiles[0].usedPublicBaseUrl, false);
    assert.equal(page.uploadHistory[0].usedPublicBaseUrl, false);
    assert.equal(page.formatLink(page.uploadedFiles[0]), 'https://site-a.example/file/r2:r2_other.jpg');
    assert.equal(page.formatLink(page.uploadedFiles[1]), 'https://images-b.example/file/r2:r2_picture.jpg');
    page.loadHistory();
    assert.equal(page.uploadHistory[0].usedPublicBaseUrl, false);
    assert.equal(page.formatLink(page.uploadHistory[0]), 'https://site-a.example/file/r2:r2_other.jpg');
    assert.equal(page.uploadHistory[1].usedPublicBaseUrl, true);
    assert.equal(page.formatLink(page.uploadHistory[1]), 'https://images-b.example/file/r2:r2_picture.jpg');
  });

  it('keeps an unchecked upload on the current site even if a public URL is configured', function () {
    const page = loadUploadPage();
    page.publicBaseUrl = 'https://images-b.example';
    page.usePublicBaseUrl = false;
    const context = page.createUploadContext();
    assert.equal(context.usedPublicBaseUrl, false);
    page.handleUploadSuccess({
      file: { name: 'unchecked.jpg', size: 1 },
      linkBaseURL: 'https://images-b.example',
      usedPublicBaseUrl: context.usedPublicBaseUrl,
    }, '/file/unchecked.jpg');
    assert.equal(page.formatLink(page.uploadedFiles[0]), 'https://site-a.example/file/unchecked.jpg');
  });

  it('freezes the checkbox choice before a URL upload request finishes', async function () {
    let finishRequest;
    const page = loadUploadPage([], () => new Promise(resolve => { finishRequest = resolve; }));
    page.showToast = () => {};
    page.urlToUpload = 'https://source.example/photo.jpg';
    page.publicBaseUrl = 'https://images-b.example';
    page.usePublicBaseUrl = true;

    const pending = page.uploadFromUrl();
    page.usePublicBaseUrl = false;
    finishRequest({ ok: true, json: async () => [{ src: '/file/photo.jpg' }] });
    await pending;

    assert.equal(page.uploadedFiles[0].usedPublicBaseUrl, true);
    assert.equal(page.formatLink(page.uploadedFiles[0]), 'https://images-b.example/file/photo.jpg');
  });

  it('keeps previews, downloads and file paths on the site when sharing via a prefixed public base', function () {
    let downloadUrl;
    const page = loadUploadPage([], undefined, url => { downloadUrl = url; });
    const file = {
      name: 'notes.txt',
      url: 'https://images-b.example/cache/file/r2:notes.txt',
      path: '/file/r2:notes.txt',
      linkBaseURL: 'https://images-b.example/cache/',
      usedPublicBaseUrl: true,
    };

    assert.equal(page.formatLink(file), 'https://images-b.example/cache/file/r2:notes.txt');
    assert.equal(page.getLocalFileUrl(file), 'https://site-a.example/file/r2:notes.txt');
    assert.equal(page.getCleanFilePath(file), '/file/r2:notes.txt');
    page.openPreview(file);
    assert.equal(page.previewData.url, 'https://site-a.example/file/r2:notes.txt');
    page.downloadFile(file);
    assert.equal(downloadUrl, 'https://site-a.example/file/r2:notes.txt');
  });

  it('does not return an unsupported link scheme as a clickable upload result', function () {
    const page = loadUploadPage();
    assert.equal(page.getCleanFileUrl({ url: 'javascript://%0Aalert(1)' }), '');
  });

  it('disables the public domain choice when no valid URL is configured', async function () {
    const { onRequestGet } = await import('../functions/api/status.js');
    const validResponse = await onRequestGet({
      env: { PUBLIC_BASE_URL: 'https://images-b.example/cache/' },
    });
    assert.equal((await validResponse.json()).publicBaseUrl, 'https://images-b.example/cache');

    const response = await onRequestGet({ env: { PUBLIC_BASE_URL: 'javascript:alert(1)' } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).publicBaseUrl, '');

    const page = loadUploadPage();
    page.usePublicBaseUrl = true;
    assert.equal(page.getSelectedLinkBaseURL(), 'https://site-a.example');
  });
});
