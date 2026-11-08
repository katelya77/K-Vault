// Used by both the Pages Functions and Docker server. Keep the existing
// salt:password SHA-256 format so API-created passwords keep working.
async function hashPassword(salt, password) {
  const bytes = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function passwordMetadata(password) {
  if (password === null) return { sharePasswordSalt: undefined, sharePasswordHash: undefined };
  const salt = crypto.randomUUID();
  return { sharePasswordSalt: salt, sharePasswordHash: await hashPassword(salt, password) };
}

function isValidPasswordSetting(password) {
  return password === null || (typeof password === 'string' && password.length > 0 && password.length <= 128);
}

async function checkPassword(request, metadata) {
  let password;
  if (request.method === 'POST') {
    password = await readFormPassword(request);
    if (password === null) return 400;
  } else {
    password = new URL(request.url).searchParams.get('password')
      || request.headers.get('X-File-Password') || request.headers.get('X-Share-Password');
  }
  if (!password) return 401;

  const expected = String(metadata.sharePasswordHash);
  const actual = await hashPassword(metadata.sharePasswordSalt || '', password);
  if (expected.length !== actual.length) return 403;
  let mismatch = 0;
  for (let i = 0; i < actual.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  }
  return mismatch === 0 ? 200 : 403;
}

async function readFormPassword(request) {
  const type = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded' || !request.body) return null;

  const reader = request.body.getReader();
  const buffer = new Uint8Array(8192);
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.length > buffer.length) {
      await reader.cancel();
      return null;
    }
    buffer.set(value, length);
    length += value.length;
  }
  const form = new URLSearchParams(new TextDecoder().decode(buffer.subarray(0, length)));
  return form.get('password') || '';
}

function publicShareMetadata(metadata) {
  const { sharePasswordHash, sharePasswordSalt, ...rest } = metadata;
  return { ...rest, sharePasswordProtected: Boolean(sharePasswordHash) };
}

function passwordErrorMessage(status) {
  if (status === 400) return 'Invalid password form';
  return status === 401 ? 'File password required' : 'File password invalid';
}

function passwordPrompt(request, status) {
  if (status === 400 || !['GET', 'POST'].includes(request.method)) return null;
  if (!/\btext\/html\b/i.test(request.headers.get('Accept') || '')) return null;
  const message = status === 403 ? '密码不正确，请重试。' : '请输入分享者提供的密码。';
  return new Response(`<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>输入分享密码 · K-Vault</title>
<style>
  body{font:1rem system-ui,sans-serif;margin:3rem auto;padding:0 1rem;max-width:28rem;color-scheme:light dark}
  form{display:grid;gap:.75rem}input,button{font:inherit;padding:.6rem}
</style>
<main><h1>此文件受密码保护</h1><p>${message}</p>
<form method="post"><label for="password">分享密码</label>
<input id="password" name="password" type="password" required autofocus>
<button type="submit">解锁并下载</button></form></main></html>`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'CDN-Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function forceAttachment(response) {
  const headers = new Headers(response.headers);
  const disposition = headers.get('Content-Disposition') || '';
  const parameters = disposition.indexOf(';');
  headers.set('Content-Disposition', parameters < 0 ? 'attachment' : `attachment${disposition.slice(parameters)}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

module.exports = {
  passwordMetadata, isValidPasswordSetting, checkPassword, publicShareMetadata,
  passwordErrorMessage, passwordPrompt, forceAttachment,
};
