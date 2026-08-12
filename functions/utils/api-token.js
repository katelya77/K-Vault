const TOKEN_PREFIX = 'kvault_';
const TOKEN_KEY_PREFIX = 'api_token:';
const VALID_SCOPES = new Set(['upload', 'read', 'delete', 'paste']);
const TOKEN_ID_LENGTH = 12;
const TOKEN_SECRET_LENGTH = 40;
const TOKEN_SALT_LENGTH = 16;
const MASK_PREFIX = '******';

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function sanitizeTokenId(rawValue = '') {
  const value = String(rawValue || '').trim();
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(value)) return '';
  return value;
}

function randomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let output = '';
  for (let i = 0; i < length; i += 1) {
    output += chars[bytes[i] % chars.length];
  }
  return output;
}

function splitToken(rawToken = '') {
  const value = String(rawToken || '').trim();
  const match = /^kvault_([A-Za-z0-9_-]{6,128})_([A-Za-z0-9_-]{16,256})$/.exec(value);
  if (!match) return null;
  return {
    tokenId: match[1],
    secret: match[2],
    value,
  };
}

function normalizeExpiresAt(rawValue) {
  if (rawValue == null || rawValue === '') return null;
  if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue) ? Math.max(0, Math.floor(rawValue)) : null;
  }
  const text = String(rawValue).trim();
  if (!text) return null;
  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.floor(numeric));
  }
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    return Math.max(0, Math.floor(parsed));
  }
  return null;
}

function normalizeScopes(rawScopes = []) {
  const list = Array.isArray(rawScopes) ? rawScopes : [rawScopes];
  const normalized = [];
  list.forEach((item) => {
    const scope = String(item || '').trim().toLowerCase();
    if (!VALID_SCOPES.has(scope)) return;
    if (normalized.includes(scope)) return;
    normalized.push(scope);
  });
  return normalized;
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(String(input || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function hashTokenSecret(secret, salt) {
  return sha256Hex(`${salt}:${secret}`);
}

function maskTokenSuffix(suffix = '') {
  const normalized = String(suffix || '');
  return `${MASK_PREFIX}${normalized}`;
}

function ensureKvBinding(env) {
  if (!env?.img_url) {
    throw new Error('KV binding img_url is not configured.');
  }
}

function toPublicRecord(record = {}) {
  return {
    id: record.id,
    name: record.name,
    scopes: Array.isArray(record.scopes) ? [...record.scopes] : [],
    expiresAt: record.expiresAt ?? null,
    createdAt: Number(record.createdAt || 0),
    lastUsedAt: record.lastUsedAt ?? null,
    enabled: Boolean(record.enabled),
    tokenPreview: record.tokenPreview || maskTokenSuffix(record.tokenSuffix || ''),
  };
}

async function getRecordById(tokenId, env) {
  ensureKvBinding(env);
  const id = sanitizeTokenId(tokenId);
  if (!id) return null;
  const value = await env.img_url.get(`${TOKEN_KEY_PREFIX}${id}`, { type: 'json' });
  if (!value || typeof value !== 'object') return null;
  return {
    ...value,
    id,
    scopes: normalizeScopes(value.scopes || []),
    enabled: value.enabled !== false,
    expiresAt: normalizeExpiresAt(value.expiresAt),
    createdAt: Number(value.createdAt || 0),
    lastUsedAt: value.lastUsedAt == null ? null : Number(value.lastUsedAt || 0),
  };
}

async function putRecord(record, env) {
  ensureKvBinding(env);
  await env.img_url.put(`${TOKEN_KEY_PREFIX}${record.id}`, JSON.stringify(record));
}

async function generateUniqueTokenId(env, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const candidate = randomString(TOKEN_ID_LENGTH);
    const exists = await env.img_url.get(`${TOKEN_KEY_PREFIX}${candidate}`);
    if (exists == null) {
      return candidate;
    }
  }
  throw new Error('Failed to generate a unique token id.');
}

export function getApiTokenScopes() {
  return [...VALID_SCOPES];
}

export function parseBearerToken(request) {
  const authorization = String(request.headers.get('Authorization') || '').trim();
  if (!authorization) return '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) return '';
  return String(match[1] || '').trim();
}

export async function createApiToken({ name, scopes, expiresAt, enabled = true }, env) {
  ensureKvBinding(env);

  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    throw new Error('Token name is required.');
  }

  const normalizedScopes = normalizeScopes(scopes);
  if (normalizedScopes.length === 0) {
    throw new Error('At least one valid scope is required.');
  }

  const tokenId = await generateUniqueTokenId(env);
  const tokenSecret = randomString(TOKEN_SECRET_LENGTH);
  const tokenSalt = randomString(TOKEN_SALT_LENGTH);
  const tokenHash = await hashTokenSecret(tokenSecret, tokenSalt);
  const tokenSuffix = tokenSecret.slice(-6);
  const now = Date.now();

  const record = {
    id: tokenId,
    name: normalizedName,
    scopes: normalizedScopes,
    expiresAt: normalizeExpiresAt(expiresAt),
    createdAt: now,
    lastUsedAt: null,
    enabled: enabled !== false,
    tokenSalt,
    tokenHash,
    tokenSuffix,
    tokenPreview: maskTokenSuffix(tokenSuffix),
  };

  await putRecord(record, env);

  return {
    token: `${TOKEN_PREFIX}${tokenId}_${tokenSecret}`,
    record: toPublicRecord(record),
  };
}

export async function listApiTokens(env) {
  ensureKvBinding(env);

  const keys = [];
  let cursor = undefined;
  let guard = 0;

  do {
    const page = await env.img_url.list({
      prefix: TOKEN_KEY_PREFIX,
      limit: 1000,
      cursor,
    });
    keys.push(...(page.keys || []).map((item) => item.name));
    cursor = page.list_complete ? undefined : page.cursor;
    guard += 1;
  } while (cursor && guard < 10000);

  const records = await Promise.all(
    keys.map(async (key) => {
      const id = key.slice(TOKEN_KEY_PREFIX.length);
      return getRecordById(id, env);
    })
  );

  return records
    .filter(Boolean)
    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
    .map((record) => toPublicRecord(record));
}

export async function updateApiToken(tokenId, patch = {}, env) {
  const record = await getRecordById(tokenId, env);
  if (!record) return null;

  const next = { ...record };

  if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
    next.enabled = Boolean(patch.enabled);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
    const normalizedName = String(patch.name || '').trim();
    if (!normalizedName) {
      throw new Error('Token name is required.');
    }
    next.name = normalizedName;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'scopes')) {
    const normalizedScopes = normalizeScopes(patch.scopes);
    if (normalizedScopes.length === 0) {
      throw new Error('At least one valid scope is required.');
    }
    next.scopes = normalizedScopes;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'expiresAt')) {
    next.expiresAt = normalizeExpiresAt(patch.expiresAt);
  }

  await putRecord(next, env);
  return toPublicRecord(next);
}

export async function deleteApiToken(tokenId, env) {
  ensureKvBinding(env);
  const id = sanitizeTokenId(tokenId);
  if (!id) return false;
  const existing = await getRecordById(id, env);
  if (!existing) return false;
  await env.img_url.delete(`${TOKEN_KEY_PREFIX}${id}`);
  return true;
}

export async function touchApiTokenLastUsed(tokenId, env, { minIntervalMs = 0 } = {}) {
  const record = await getRecordById(tokenId, env);
  if (!record) return false;

  const now = Date.now();
  const interval = Math.max(0, Number(minIntervalMs) || 0);
  const lastUsedAt = Number(record.lastUsedAt || 0);
  if (interval > 0 && lastUsedAt > 0 && now - lastUsedAt < interval) {
    return false;
  }

  record.lastUsedAt = now;
  await putRecord(record, env);
  return true;
}

export async function verifyApiToken(tokenValue, env, requiredScope = '') {
  const split = splitToken(tokenValue);
  if (!split) {
    return {
      ok: false,
      status: 401,
      code: 'TOKEN_INVALID',
      message: 'API Token is invalid.',
    };
  }

  const record = await getRecordById(split.tokenId, env);
  if (!record) {
    return {
      ok: false,
      status: 401,
      code: 'TOKEN_INVALID',
      message: 'API Token is invalid.',
    };
  }

  const expectedHash = await hashTokenSecret(split.secret, record.tokenSalt || '');
  if (!timingSafeEqual(expectedHash, String(record.tokenHash || ''))) {
    return {
      ok: false,
      status: 401,
      code: 'TOKEN_INVALID',
      message: 'API Token is invalid.',
    };
  }

  if (!record.enabled) {
    return {
      ok: false,
      status: 401,
      code: 'TOKEN_DISABLED',
      message: 'API Token is disabled.',
    };
  }

  if (Number.isFinite(record.expiresAt) && record.expiresAt > 0 && Date.now() > record.expiresAt) {
    return {
      ok: false,
      status: 401,
      code: 'TOKEN_EXPIRED',
      message: 'API Token has expired.',
    };
  }

  const normalizedScope = String(requiredScope || '').trim().toLowerCase();
  if (normalizedScope && !record.scopes.includes(normalizedScope)) {
    return {
      ok: false,
      status: 403,
      code: 'TOKEN_SCOPE_DENIED',
      message: `API Token does not include "${normalizedScope}" scope.`,
    };
  }

  return {
    ok: true,
    token: toPublicRecord(record),
  };
}
