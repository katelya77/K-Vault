const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

export function apiSuccess(payload = {}, status = 200, headers = {}) {
  return new Response(
    JSON.stringify({
      success: true,
      ...payload,
    }),
    {
      status,
      headers: {
        ...JSON_HEADERS,
        ...headers,
      },
    }
  );
}

export function apiError(code, message, status = 400, extra = {}, headers = {}) {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        code,
        message,
        ...extra,
      },
    }),
    {
      status,
      headers: {
        ...JSON_HEADERS,
        ...headers,
      },
    }
  );
}

export async function readIdempotentResponse(env, key) {
  if (!key || !env?.img_url) return null;
  try {
    const saved = await env.img_url.get(key, { type: 'json' });
    if (saved?.status && saved?.body) {
      return apiSuccess(saved.body, saved.status, { 'Idempotency-Replayed': 'true' });
    }
  } catch { /* replay lookup failure is non-fatal */ }
  return null;
}

export async function saveIdempotentResponse(env, key, body, status) {
  if (!key || !env?.img_url) return;
  try {
    await env.img_url.put(key, JSON.stringify({ body, status }), { expirationTtl: 24 * 3600 });
  } catch { /* replay snapshot failure is non-fatal */ }
}

export function decodePathParam(rawValue = '') {
  try {
    return decodeURIComponent(String(rawValue || ''));
  } catch {
    return String(rawValue || '');
  }
}

export function parsePositiveInt(rawValue, { defaultValue = 0, min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(Math.max(parsed, min), max);
}

export function parseBoolean(rawValue, fallback = false) {
  if (rawValue == null) return fallback;
  const value = String(rawValue).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled', 'enable'].includes(value)) return true;
  if (['0', 'false', 'no', 'off', 'disabled', 'disable'].includes(value)) return false;
  return fallback;
}

export function buildAbsoluteUrl(request, path) {
  const origin = new URL(request.url).origin;
  const normalizedPath = String(path || '').startsWith('/') ? String(path) : `/${String(path || '')}`;
  return `${origin}${normalizedPath}`;
}

/**
 * Map a thrown token/validation error to a proper API error response.
 * Used by admin token routes for strict INVALID_SCOPE / INVALID_EXPIRY /
 * INVALID_POLICY handling (requirements #8, #9, #10).
 */
export function tokenErrorResponse(error, fallbackCode = 'TOKEN_OPERATION_FAILED', fallbackStatus = 400) {
  const code = String(error?.code || '');
  if (code === 'INVALID_SCOPE') {
    return apiError('INVALID_SCOPE', error.message || 'Invalid scopes.', 400, {
      invalidScopes: Array.isArray(error.invalidScopes) ? error.invalidScopes : [],
    });
  }
  if (code === 'INVALID_EXPIRY') {
    return apiError('INVALID_EXPIRY', error.message || 'Invalid expiry.', 400);
  }
  if (code === 'INVALID_POLICY') {
    return apiError('INVALID_POLICY', error.message || 'Invalid policies.', 400, {
      invalidStorages: Array.isArray(error.invalidStorages) ? error.invalidStorages : undefined,
      invalidMimeTypes: Array.isArray(error.invalidMimeTypes) ? error.invalidMimeTypes : undefined,
      invalidHosts: Array.isArray(error.invalidHosts) ? error.invalidHosts : undefined,
    });
  }
  if (code === 'VALIDATION_ERROR') {
    return apiError('VALIDATION_ERROR', error.message || 'Validation failed.', 400);
  }
  return apiError(fallbackCode, error?.message || 'Token operation failed.', fallbackStatus);
}

/**
 * Parse user-facing expiry input for token create/update.
 * Supports ISO-8601 strings, expiresAtMs, expiresIn/expires_in (seconds) and
 * expiresInDays. Bare numeric expiresAt throws INVALID_EXPIRY.
 */
export function parseTokenExpiryFromBody(body = {}) {
  if (Object.prototype.hasOwnProperty.call(body, 'expiresAtMs')) {
    return { kind: 'expiresAtMs', value: body.expiresAtMs };
  }
  if (Object.prototype.hasOwnProperty.call(body, 'expiresAt')) {
    return { kind: 'iso', value: body.expiresAt };
  }
  if (Object.prototype.hasOwnProperty.call(body, 'expires_in')) {
    const seconds = parsePositiveInt(body.expires_in, { defaultValue: 0, min: 1, max: 3650 * 24 * 3600 });
    return { kind: 'ms', value: seconds > 0 ? Date.now() + seconds * 1000 : null };
  }
  if (Object.prototype.hasOwnProperty.call(body, 'expiresIn')) {
    const seconds = parsePositiveInt(body.expiresIn, { defaultValue: 0, min: 1, max: 3650 * 24 * 3600 });
    return { kind: 'ms', value: seconds > 0 ? Date.now() + seconds * 1000 : null };
  }
  if (Object.prototype.hasOwnProperty.call(body, 'expiresInDays')) {
    const days = parsePositiveInt(body.expiresInDays, { defaultValue: 0, min: 1, max: 3650 });
    return { kind: 'ms', value: days > 0 ? Date.now() + days * 24 * 3600 * 1000 : null };
  }
  return { kind: 'none', value: null };
}
