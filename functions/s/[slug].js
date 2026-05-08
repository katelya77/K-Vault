/**
 * 分享链接重定向 - 支持数据库和 KV
 */

import { ShareRepository } from '../server/lib/db/repository.js';

const SHARE_SLUG_KEY_PREFIX = 'share_slug:';

function decodePathParam(rawValue = '') {
  try {
    return decodeURIComponent(String(rawValue || ''));
  } catch {
    return String(rawValue || '');
  }
}

function normalizeSlug(rawValue = '') {
  const value = String(rawValue || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(value)) return '';
  return value;
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(String(input || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const rawValue = decodePathParam(params?.slug || '');
  if (!rawValue) {
    return new Response('Not found', { status: 404 });
  }

  let targetId = '';
  const normalizedSlug = normalizeSlug(rawValue);

  if (env.DB && normalizedSlug) {
    try {
      const shareRepo = new ShareRepository(env.DB);
      const share = await shareRepo.findBySlug(normalizedSlug);

      if (share) {
        if (share.expires_at && Date.now() > share.expires_at) {
          return new Response('Share link has expired', { status: 410 });
        }

        if (share.max_downloads > 0 && share.download_count >= share.max_downloads) {
          return new Response('Download limit exceeded', { status: 410 });
        }

        const url = new URL(request.url);
        const password = url.searchParams.get('password');

        if (share.password_hash) {
          if (!password) {
            const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Password Required</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 50px; text-align: center; }
    input[type="password"] { padding: 10px; font-size: 16px; margin: 10px; }
    button { padding: 10px 20px; font-size: 16px; cursor: pointer; }
  </style>
</head>
<body>
  <h2>Password Required</h2>
  <form method="get">
    <input type="password" name="password" placeholder="Enter password" required>
    <button type="submit">Submit</button>
  </form>
</body>
</html>`;
            return new Response(html, {
              headers: { 'Content-Type': 'text/html' }
            });
          }

          const passwordHash = await sha256Hex(password);
          if (passwordHash !== share.password_hash) {
            return new Response('Invalid password', { status: 403 });
          }
        }

        await shareRepo.incrementDownloadCount(share.id);

        targetId = share.file_id;
      }
    } catch (error) {
      console.error('Share lookup error:', error);
    }
  }

  if (!targetId && normalizedSlug && env?.img_url) {
    const mappedId = await env.img_url.get(`${SHARE_SLUG_KEY_PREFIX}${normalizedSlug}`);
    if (mappedId) {
      targetId = String(mappedId);
    }
  }

  if (!targetId) {
    targetId = rawValue;
  }

  const redirectUrl = new URL(`/file/${encodeURIComponent(targetId)}`, request.url);
  const sourceUrl = new URL(request.url);
  sourceUrl.searchParams.forEach((value, key) => {
    if (key !== 'password') {
      redirectUrl.searchParams.set(key, value);
    }
  });

  return Response.redirect(redirectUrl.toString(), 302);
}
