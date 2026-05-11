#!/usr/bin/env node

/**
 * K-Vault storage regression helper
 *
 * Usage example:
 *   BASE_URL=http://localhost:8080 \
 *   ADMIN_EMAIL=admin@example.com \
 *   SMOKE_STORAGE_TYPE=webdav \
 *   SMOKE_STORAGE_CONFIG_JSON='{"baseUrl":"https://dav.example.com","username":"u","password":"p"}' \
 *   node scripts/storage-regression.js
 */

const BASE_URL = String(process.env.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '');
const ADMIN_PASS = String(process.env.ADMIN_PASS || 'admin123');
const SMOKE_STORAGE_TYPE = String(process.env.SMOKE_STORAGE_TYPE || '').trim().toLowerCase();
const SMOKE_STORAGE_CONFIG_JSON = String(process.env.SMOKE_STORAGE_CONFIG_JSON || '').trim();
const TEST_ONLY_TYPES = String(process.env.TEST_ONLY_TYPES || '')
  .split(',')
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean);

const state = {
  cookies: new Map(),
};

function setCookieFromHeaders(headers) {
  const cookieHeaders = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  for (const cookieLine of cookieHeaders) {
    const first = String(cookieLine || '').split(';')[0].trim();
    if (!first.includes('=')) continue;
    const [name, ...rest] = first.split('=');
    state.cookies.set(name, rest.join('='));
  }
}

function cookieHeader() {
  if (!state.cookies.size) return '';
  return [...state.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function buildUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${BASE_URL}${path}`;
}

async function request(path, { method = 'GET', headers = {}, body = null, allowError = false } = {}) {
  const url = buildUrl(path);
  const cookie = cookieHeader();
  const finalHeaders = { ...headers };
  if (cookie) finalHeaders.Cookie = cookie;

  const response = await fetch(url, {
    method,
    headers: finalHeaders,
    body,
    redirect: 'follow',
  });

  setCookieFromHeaders(response.headers);

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => '');

  if (!allowError && !response.ok) {
    const message = typeof payload === 'string'
      ? payload
      : payload.error || payload.message || `HTTP ${response.status}`;
    throw new Error(`${method} ${path} failed: ${message}`);
  }

  return { response, payload };
}

function logStep(title) {
  process.stdout.write(`\n[STEP] ${title}\n`);
}

function logOk(message) {
  process.stdout.write(`  ✔ ${message}\n`);
}

async function ensureLoginIfNeeded() {
  logStep('Auth check + login');
  const authCheck = await request('/api/auth/check');
  const authRequired = Boolean(authCheck.payload?.authRequired);
  logOk(`authRequired = ${authRequired}`);

  if (!authRequired) {
    logOk('Auth disabled, skip login payload checks');
    return;
  }

  if (!ADMIN_EMAIL) {
    throw new Error('Auth is required. Set ADMIN_EMAIL for regression script.');
  }

  const loginNew = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
  });
  if (!loginNew.payload?.success) {
    throw new Error('Login with {email,password} did not succeed.');
  }
  logOk('login payload {email,password} passed');
}

async function checkHealthAndStatus() {
  logStep('Health + Status');
  const health = await request('/api/health');
  if (!health.payload?.ok) throw new Error('/api/health did not return ok=true');
  logOk('/api/health ok');

  const status = await request('/api/status');
  const storageKeys = ['telegram', 'r2', 's3', 'discord', 'huggingface', 'webdav', 'github'];
  for (const key of storageKeys) {
    if (!Object.prototype.hasOwnProperty.call(status.payload || {}, key)) {
      throw new Error(`/api/status missing key: ${key}`);
    }
  }
  logOk('/api/status includes all storage keys');

  if (SMOKE_STORAGE_TYPE) {
    const smokeStatus = status.payload?.[SMOKE_STORAGE_TYPE];
    if (smokeStatus?.configured && !smokeStatus?.connected) {
      throw new Error(`/api/status reports ${SMOKE_STORAGE_TYPE} disconnected: ${smokeStatus.message || smokeStatus.detail || 'unknown error'}`);
    }
  }
}

function parseSmokeConfig() {
  if (!SMOKE_STORAGE_CONFIG_JSON) return null;
  try {
    return JSON.parse(SMOKE_STORAGE_CONFIG_JSON);
  } catch (error) {
    throw new Error(`SMOKE_STORAGE_CONFIG_JSON is not valid JSON: ${error.message}`);
  }
}

async function storageCrudAndSelection() {
  logStep('Storage list / create / update / test / default');

  const listed = await request('/api/storage/list');
  const initialItems = listed.payload?.items || [];
  logOk(`initial storage configs: ${initialItems.length}`);

  const originalDefault = initialItems.find((item) => item.isDefault)?.id || null;
  let created = null;

  const smokeConfig = parseSmokeConfig();
  if (SMOKE_STORAGE_TYPE && smokeConfig) {
    const createRes = await request('/api/storage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `smoke-${SMOKE_STORAGE_TYPE}-${Date.now()}`,
        type: SMOKE_STORAGE_TYPE,
        enabled: true,
        isDefault: false,
        config: smokeConfig,
      }),
    });
    created = createRes.payload?.item;
    if (!created?.id) throw new Error('Storage create succeeded without item.id');
    logOk(`created storage config: ${created.id}`);

    const updateRes = await request(`/api/storage/${encodeURIComponent(created.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${created.name}-updated`,
      }),
    });
    if (!updateRes.payload?.item?.name?.endsWith('-updated')) {
      throw new Error('Storage update did not apply expected name suffix.');
    }
    logOk('update storage config passed');

    const createdTest = await request(`/api/storage/${encodeURIComponent(created.id)}/test`, {
      method: 'POST',
      allowError: true,
    });
    const testBody = createdTest.payload || {};
    const testResult = testBody.result || testBody;
    if (!testResult.connected) {
      throw new Error(`created storage test failed: ${testResult.detail || testResult.message || 'unknown error'}`);
    }
    logOk(`created storage test -> connected=${Boolean(testResult.connected)} status=${testResult.status || 'n/a'}`);

    await request(`/api/storage/default/${encodeURIComponent(created.id)}`, {
      method: 'POST',
    });
    logOk('set created config as default passed');
  } else {
    logOk('create/update skipped (set SMOKE_STORAGE_TYPE + SMOKE_STORAGE_CONFIG_JSON to enable)');
  }

  return { createdId: created?.id || null, originalDefault };
}

async function uploadDownloadDeleteForEnabledStorages() {
  logStep('Upload / Download / Delete by storage');

  const listed = await request('/api/storage/list');
  const allItems = (listed.payload?.items || []).filter((item) => item.enabled);
  const items = TEST_ONLY_TYPES.length
    ? allItems.filter((item) => TEST_ONLY_TYPES.includes(String(item.type || '').toLowerCase()))
    : allItems;

  if (!items.length) {
    logOk('no enabled storage configs found, skip file IO checks');
    return;
  }

  for (const item of items) {
    const marker = `smoke-${item.type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const fileName = `smoke-${item.type}.txt`;
    const file = new File([marker], fileName, { type: 'text/plain' });

    const body = new FormData();
    body.append('file', file);
    body.append('storageId', item.id);

    const uploadRes = await request('/upload', {
      method: 'POST',
      body,
    });
    const src = Array.isArray(uploadRes.payload)
      ? uploadRes.payload[0]?.src
      : uploadRes.payload?.src;

    if (!src) {
      throw new Error(`upload for storage=${item.type} did not return src`);
    }
    logOk(`${item.type}: upload passed`);

    const downloadRes = await request(src, { allowError: true });
    if (downloadRes.response.status >= 400) {
      throw new Error(`${item.type}: download failed with status ${downloadRes.response.status}`);
    }

    const text = typeof downloadRes.payload === 'string'
      ? downloadRes.payload
      : '';
    if (!text.includes(marker)) {
      throw new Error(`${item.type}: downloaded content mismatch`);
    }
    logOk(`${item.type}: download passed`);

    const fileId = decodeURIComponent(String(src).split('/file/')[1] || '');
    if (!fileId) {
      throw new Error(`${item.type}: cannot parse fileId from src=${src}`);
    }

    const deleteRes = await request(`/api/manage/delete/${encodeURIComponent(fileId)}`, {
      method: 'GET',
      allowError: true,
    });
    if (!deleteRes.payload?.success) {
      throw new Error(`${item.type}: delete failed: ${deleteRes.payload?.error || 'unknown error'}`);
    }
    logOk(`${item.type}: delete passed`);
  }
}

async function cleanupStorage(createdId, originalDefaultId) {
  logStep('Cleanup');

  if (originalDefaultId) {
    await request(`/api/storage/default/${encodeURIComponent(originalDefaultId)}`, {
      method: 'POST',
      allowError: true,
    });
    logOk('restored original default storage (best effort)');
  }

  if (createdId) {
    await request(`/api/storage/${encodeURIComponent(createdId)}`, {
      method: 'DELETE',
      allowError: true,
    });
    logOk('deleted created smoke storage (best effort)');
  }
}

async function main() {
  process.stdout.write(`K-Vault storage regression start\nBASE_URL=${BASE_URL}\n`);

  await ensureLoginIfNeeded();
  const { createdId, originalDefault } = await storageCrudAndSelection();
  await checkHealthAndStatus();
  await uploadDownloadDeleteForEnabledStorages();
  await cleanupStorage(createdId, originalDefault);

  process.stdout.write('\nAll regression checks completed.\n');
}

main().catch((error) => {
  process.stderr.write(`\nRegression failed: ${error.message}\n`);
  process.exit(1);
});
