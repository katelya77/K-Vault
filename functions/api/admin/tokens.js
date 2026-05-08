/**
 * API Token 管理 API - 基于数据库实现
 */

import { ApiTokenRepository } from '../../server/lib/db/repository.js';

const TOKEN_PREFIX = 'kvault_';
const TOKEN_SECRET_LENGTH = 40;
const VALID_SCOPES = new Set(['upload', 'read', 'delete', 'paste']);

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

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(String(input || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
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

function parsePositiveInt(value, defaultValue, min = 1, max = 1000000000) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(min, Math.min(max, parsed));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  try {
    if (!env.DB) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Database not configured',
        errorCode: 'DB_NOT_CONFIGURED'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const tokenRepo = new ApiTokenRepository(env.DB);
    const page = parsePositiveInt(url.searchParams.get('page'), 1, 1, 10000);
    const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 20, 1, 200);

    const result = await tokenRepo.list({ page, pageSize });

    const tokens = result.items.map(token => ({
      id: token.id,
      name: token.name,
      tokenPreview: `******${token.token_hash.slice(-6)}`,
      enabled: Boolean(token.enabled),
      createdAt: token.created_at,
      lastUsedAt: token.last_used_at
    }));

    return new Response(JSON.stringify({
      success: true,
      result: tokens,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('List API tokens error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      errorCode: 'LIST_TOKENS_ERROR'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!env.DB) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Database not configured',
        errorCode: 'DB_NOT_CONFIGURED'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const tokenRepo = new ApiTokenRepository(env.DB);
    const body = await request.json();

    const name = String(body.name || '').trim();
    if (!name) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Token name is required',
        errorCode: 'NAME_REQUIRED'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const scopes = normalizeScopes(body.scopes || ['upload']);
    if (scopes.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'At least one valid scope is required',
        errorCode: 'INVALID_SCOPES',
        validScopes: [...VALID_SCOPES]
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const tokenSecret = randomString(TOKEN_SECRET_LENGTH);
    const tokenHash = await sha256Hex(tokenSecret);
    const tokenId = randomString(12);

    const token = await tokenRepo.create({
      id: tokenId,
      name,
      tokenHash,
      enabled: true
    });

    const fullToken = `${TOKEN_PREFIX}${tokenId}_${tokenSecret}`;

    return new Response(JSON.stringify({
      success: true,
      result: {
        id: token.id,
        name: token.name,
        token: fullToken,
        tokenPreview: `******${tokenSecret.slice(-6)}`,
        enabled: Boolean(token.enabled),
        createdAt: token.created_at,
        warning: 'This is the only time you will see the full token. Please save it securely.'
      }
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Create API token error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      errorCode: 'CREATE_TOKEN_ERROR'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  try {
    if (!env.DB) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Database not configured',
        errorCode: 'DB_NOT_CONFIGURED'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const tokenRepo = new ApiTokenRepository(env.DB);
    const tokenId = url.searchParams.get('id');

    if (!tokenId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Token ID is required',
        errorCode: 'ID_REQUIRED'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const token = await tokenRepo.findById(tokenId);
    if (!token) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Token not found',
        errorCode: 'TOKEN_NOT_FOUND'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await tokenRepo.delete(tokenId);

    return new Response(JSON.stringify({
      success: true,
      message: 'Token deleted successfully'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Delete API token error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      errorCode: 'DELETE_TOKEN_ERROR'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  try {
    if (!env.DB) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Database not configured',
        errorCode: 'DB_NOT_CONFIGURED'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const tokenRepo = new ApiTokenRepository(env.DB);
    const tokenId = url.searchParams.get('id');

    if (!tokenId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Token ID is required',
        errorCode: 'ID_REQUIRED'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const updates = {};

    if (body.name !== undefined) {
      updates.name = String(body.name || '').trim();
    }

    if (body.enabled !== undefined) {
      updates.enabled = Boolean(body.enabled);
    }

    if (Object.keys(updates).length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No valid updates provided',
        errorCode: 'NO_UPDATES'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const token = await tokenRepo.update(tokenId, updates);

    if (!token) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Token not found',
        errorCode: 'TOKEN_NOT_FOUND'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      result: {
        id: token.id,
        name: token.name,
        enabled: Boolean(token.enabled),
        updatedAt: token.updated_at
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Update API token error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      errorCode: 'UPDATE_TOKEN_ERROR'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
