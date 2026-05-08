/**
 * 分享链接管理 API - 基于数据库实现
 */

import { ShareRepository, FileRepository } from '../../server/lib/db/repository.js';

function generateSlug(length = 8) {
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

function parsePositiveInt(value, defaultValue, min = 1, max = 1000000000) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(min, Math.min(max, parsed));
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

    const shareRepo = new ShareRepository(env.DB);
    const fileRepo = new FileRepository(env.DB);
    const body = await request.json();

    const fileId = body.fileId;
    const password = body.password;
    const expiresIn = parsePositiveInt(body.expiresIn, 0, 0, 365 * 24 * 3600);
    const maxDownloads = parsePositiveInt(body.maxDownloads, 0, 0, 1000000000);

    if (!fileId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'File ID is required',
        errorCode: 'FILE_ID_REQUIRED'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const file = await fileRepo.findById(fileId);
    if (!file) {
      return new Response(JSON.stringify({
        success: false,
        error: 'File not found',
        errorCode: 'FILE_NOT_FOUND'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let slug = generateSlug();
    let attempts = 0;
    while (attempts < 10) {
      const existing = await shareRepo.findBySlug(slug);
      if (!existing) break;
      slug = generateSlug();
      attempts += 1;
    }

    if (attempts >= 10) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to generate unique slug',
        errorCode: 'SLUG_GENERATION_FAILED'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const passwordHash = password ? await sha256Hex(password) : null;
    const expiresAt = expiresIn > 0 ? Date.now() + expiresIn * 1000 : null;

    const share = await shareRepo.create({
      slug,
      fileId,
      passwordHash,
      expiresAt,
      maxDownloads
    });

    return new Response(JSON.stringify({
      success: true,
      result: {
        id: share.id,
        slug: share.slug,
        fileId: share.file_id,
        url: `${new URL(request.url).origin}/s/${share.slug}`,
        expiresAt: share.expires_at,
        maxDownloads: share.max_downloads,
        createdAt: share.created_at
      }
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Create share error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      errorCode: 'CREATE_SHARE_ERROR'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
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

    const shareRepo = new ShareRepository(env.DB);
    const page = parsePositiveInt(url.searchParams.get('page'), 1, 1, 10000);
    const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 20, 1, 200);

    const result = await shareRepo.list({ page, pageSize });

    const shares = await Promise.all(
      result.items.map(async (share) => {
        const fileRepo = new FileRepository(env.DB);
        const file = await fileRepo.findById(share.file_id);
        return {
          id: share.id,
          slug: share.slug,
          fileId: share.file_id,
          fileName: file?.file_name || 'Unknown',
          url: `${new URL(request.url).origin}/s/${share.slug}`,
          hasPassword: Boolean(share.password_hash),
          expiresAt: share.expires_at,
          maxDownloads: share.max_downloads,
          downloadCount: share.download_count,
          createdAt: share.created_at
        };
      })
    );

    return new Response(JSON.stringify({
      success: true,
      result: shares,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('List shares error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      errorCode: 'LIST_SHARES_ERROR'
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

    const shareRepo = new ShareRepository(env.DB);
    const shareId = url.searchParams.get('id');
    const slug = url.searchParams.get('slug');

    if (!shareId && !slug) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Share ID or slug is required',
        errorCode: 'ID_OR_SLUG_REQUIRED'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let share;
    if (shareId) {
      share = await shareRepo.findById(shareId);
    } else {
      share = await shareRepo.findBySlug(slug);
    }

    if (!share) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Share not found',
        errorCode: 'SHARE_NOT_FOUND'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await shareRepo.delete(share.id);

    return new Response(JSON.stringify({
      success: true,
      message: 'Share deleted successfully'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Delete share error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      errorCode: 'DELETE_SHARE_ERROR'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
