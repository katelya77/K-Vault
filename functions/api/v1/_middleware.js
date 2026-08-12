import {
  parseBearerToken,
  touchApiTokenLastUsed,
  verifyApiToken,
} from '../../utils/api-token.js';
import { apiError } from '../../utils/api-v1.js';

const MINIMIZED_LAST_USED_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

function resolveRequiredScope(request) {
  const pathname = new URL(request.url).pathname.replace(/\/+$/, '');
  const method = String(request.method || 'GET').toUpperCase();

  const base = '/api/v1';
  if (!pathname.startsWith(base)) return '';
  const subPath = pathname.slice(base.length) || '/';

  if (method === 'POST' && subPath === '/upload') return 'upload';
  if (method === 'GET' && subPath === '/files') return 'read';
  if (method === 'GET' && /^\/file\/[^/]+$/.test(subPath)) return 'read';
  if (method === 'GET' && /^\/file\/[^/]+\/info$/.test(subPath)) return 'read';
  if (method === 'DELETE' && /^\/file\/[^/]+$/.test(subPath)) return 'delete';

  if (method === 'POST' && subPath === '/paste') return 'paste';
  if (method === 'GET' && subPath === '/pastes') return 'read';
  if (method === 'GET' && /^\/paste\/[^/]+$/.test(subPath)) return 'read';
  if (method === 'DELETE' && /^\/paste\/[^/]+$/.test(subPath)) return 'delete';

  return '';
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return context.next();
  }

  if (!context.env?.img_url) {
    return apiError(
      'SERVER_MISCONFIGURED',
      'KV binding img_url is not configured.',
      500
    );
  }

  const requiredScope = resolveRequiredScope(context.request);
  if (!requiredScope) {
    return context.next();
  }

  const tokenValue = parseBearerToken(context.request);
  const verifyResult = await verifyApiToken(tokenValue, context.env, requiredScope);

  if (!verifyResult.ok) {
    return apiError(
      verifyResult.code || 'TOKEN_INVALID',
      verifyResult.message || 'API Token is invalid.',
      verifyResult.status || 401
    );
  }

  context.data = context.data || {};
  context.data.apiToken = verifyResult.token;

  const minimizeKvWrites = context.env?.MINIMIZE_KV_WRITES === 'true';
  const lastUsedAt = Number(verifyResult.token.lastUsedAt || 0);
  const shouldTouchLastUsed = !minimizeKvWrites
    || lastUsedAt <= 0
    || Date.now() - lastUsedAt >= MINIMIZED_LAST_USED_UPDATE_INTERVAL_MS;

  // Token validation still needs a KV read. In low-write mode, persist activity at most once per hour.
  if (shouldTouchLastUsed) {
    const touchPromise = touchApiTokenLastUsed(verifyResult.token.id, context.env, {
      minIntervalMs: minimizeKvWrites ? MINIMIZED_LAST_USED_UPDATE_INTERVAL_MS : 0,
    }).catch((error) => {
      console.warn('Failed to update API token lastUsedAt:', error?.message || error);
    });
    if (typeof context.waitUntil === 'function') {
      context.waitUntil(touchPromise);
    }
  }

  return context.next();
}
