/**
 * 认证工具模块
 * 支持 Cookie-based 会话认证和 Basic Auth
 */

const SESSION_COOKIE_NAME = 'k_vault_session';
const LEGACY_SESSION_COOKIE_NAME = 'katelya_session';
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24小时

// 本地开发用的内存会话存储
const memorySessions = new Map();

/**
 * 生成会话令牌
 */
export function generateSessionToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 从 Cookie 获取会话
 */
export function getSessionFromCookie(request) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, value] = cookie.split('=');
    if (name === SESSION_COOKIE_NAME || name === LEGACY_SESSION_COOKIE_NAME) {
      return value;
    }
  }
  return null;
}

/**
 * 检查是否可以使用内存存储
 */
function canUseMemoryStorage(env) {
  return env.ALLOW_MEMORY_SESSION === 'true' || env.ALLOW_MEMORY_SESSION === true;
}

/**
 * 验证会话令牌
 */
export async function verifySession(sessionToken, env) {
  if (!sessionToken) return false;
  
  try {
    // 如果有 KV，使用 KV 存储
    if (env.img_url) {
      const sessionData = await env.img_url.get(`session:${sessionToken}`, { type: 'json' });
      if (!sessionData) return false;
      
      if (Date.now() > sessionData.expiresAt) {
        await env.img_url.delete(`session:${sessionToken}`);
        return false;
      }
      
      return true;
    }
    
    // 检查是否允许内存存储
    if (!canUseMemoryStorage(env)) {
      console.error('Session storage not configured. Please bind KV namespace (img_url) or set ALLOW_MEMORY_SESSION=true for development.');
      return false;
    }
    
    // 使用内存存储（本地开发）
    const sessionData = memorySessions.get(sessionToken);
    if (!sessionData) return false;
    
    if (Date.now() > sessionData.expiresAt) {
      memorySessions.delete(sessionToken);
      return false;
    }
    
    return true;
  } catch (e) {
    console.error('Session verify error:', e);
    return false;
  }
}

/**
 * 创建会话
 */
export async function createSession(userId, env) {
  const token = generateSessionToken();
  const sessionData = {
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_DURATION
  };
  
  // 如果有 KV，使用 KV 存储
  if (env.img_url) {
    await env.img_url.put(`session:${token}`, JSON.stringify(sessionData), {
      expirationTtl: Math.floor(SESSION_DURATION / 1000)
    });
    return token;
  }
  
  // 检查是否允许内存存储
  if (!canUseMemoryStorage(env)) {
    throw new Error('Session storage not configured. Please bind KV namespace (img_url) or set ALLOW_MEMORY_SESSION=true for development.');
  }
  
  // 使用内存存储（本地开发）
  memorySessions.set(token, sessionData);
  
  return token;
}

/**
 * 删除会话
 */
export async function deleteSession(sessionToken, env) {
  if (sessionToken && env.img_url) {
    await env.img_url.delete(`session:${sessionToken}`);
  }
}

/**
 * 创建带会话 Cookie 的响应
 */
export function createSessionCookieHeader(token, maxAge = SESSION_DURATION / 1000) {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${maxAge}`;
}

/**
 * 创建清除会话 Cookie 的响应头
 */
export function createClearSessionCookieHeader() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`;
}

export function createLegacyClearSessionCookieHeader() {
  return `${LEGACY_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`;
}

/**
 * 检查是否需要认证 — 现在始终基于 DB 用户，恒为 true
 */
export function isAuthRequired(_env) {
  return true;
}

/**
 * 从 Authorization Header 获取 Bearer Token
 */
export function getBearerToken(request) {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return null;
  const [scheme, token] = authorization.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

/**
 * 确保用户有 download_secret，没有则自动生成 32 字节随机密钥
 * 密钥仅存 DB，不暴露给前端，不依赖任何环境变量
 */
export async function ensureUserDownloadSecret(env, userId) {
  const row = await env.DB.prepare(
    "SELECT download_secret FROM users WHERE id = ? LIMIT 1"
  ).bind(userId).first();

  if (row && row.download_secret) {
    return row.download_secret;
  }

  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const secret = Array.from(array, b => b.toString(16).padStart(2, '0')).join('');

  await env.DB.prepare(
    "UPDATE users SET download_secret = ? WHERE id = ?"
  ).bind(secret, userId).run();

  return secret;
}

/**
 * 生成文件下载临时令牌（HMAC-SHA256 签名）
 * 签名数据绑定 fileId + expires + uid，防止 token 串用
 *
 * @param {string} fileId - 文件 ID
 * @param {number} fileSize - 文件大小（字节）
 * @param {string} secret - 用户专属 download_secret
 * @param {string} uid - 用户 ID
 * @returns {Promise<{token: string, expires: number, uid: string}>}
 */
export async function generateDownloadToken(fileId, fileSize, secret, uid) {
  const BASE_BUFFER = 90;
  const MIN_SPEED = 102400;
  const SAFETY_FACTOR = 1.6;
  const MIN_TTL = 180;
  const MAX_TTL = 86400;

  const ttl = BASE_BUFFER + Math.max(MIN_TTL, Math.ceil(fileSize / MIN_SPEED)) * SAFETY_FACTOR;
  const expires = Math.floor(Date.now() / 1000) + Math.min(ttl, MAX_TTL);
  const data = `${fileId}:${expires}:${uid}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const sigHex = Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
  return { token: sigHex, expires, uid };
}

/**
 * 验证文件下载临时令牌
 * @param {string} fileId - 文件 ID
 * @param {string} token - 待验证的令牌
 * @param {string} expires - 过期时间戳
 * @param {string} secret - 用户专属 download_secret
 * @param {string} uid - 用户 ID
 * @returns {Promise<boolean>}
 */
export async function verifyDownloadToken(fileId, token, expires, secret, uid) {
  const now = Math.floor(Date.now() / 1000);
  if (now > parseInt(expires, 10)) return false;

  const data = `${fileId}:${expires}:${uid}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const sigHex = Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
  return sigHex === token;
}

/**
 * 从令牌获取会话数据（含 userId）
 */
export async function getSessionUser(sessionToken, env) {
  if (!sessionToken) return null;

  try {
    if (env.img_url) {
      const sessionData = await env.img_url.get(`session:${sessionToken}`, { type: 'json' });
      if (!sessionData || Date.now() > sessionData.expiresAt) {
        if (sessionData) await env.img_url.delete(`session:${sessionToken}`);
        return null;
      }
      return sessionData;
    }

    if (!canUseMemoryStorage(env)) return null;

    const sessionData = memorySessions.get(sessionToken);
    if (!sessionData || Date.now() > sessionData.expiresAt) {
      if (sessionData) memorySessions.delete(sessionToken);
      return null;
    }
    return sessionData;
  } catch (e) {
    return null;
  }
}

/**
 * 密码哈希（PBKDF2 + SHA-256，10000 次迭代）
 * 返回 base64(salt):base64(hash) 格式
 */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 10000, hash: 'SHA-256' }, key, 256);
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return `${saltB64}:${hashB64}`;
}

/**
 * 验证密码
 */
export async function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [saltB64, hashB64] = stored.split(':');
  try {
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
    const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 10000, hash: 'SHA-256' }, key, 256);
    const actualHash = new Uint8Array(hash);
    if (btoa(String.fromCharCode(...actualHash)) !== hashB64) return false;
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 综合认证检查
 */
export async function checkAuthentication(context) {
  const { request, env } = context;
  
  // 如果没有配置认证，直接放行
  if (!isAuthRequired(env)) {
    return { authenticated: true, reason: 'no-auth-required' };
  }
  
  // 检查 Cookie 会话
  const sessionToken = getSessionFromCookie(request);
  if (sessionToken) {
    const sessionData = await getSessionUser(sessionToken, env);
    if (sessionData) {
      return { authenticated: true, reason: 'session', token: sessionToken, userId: sessionData.userId };
    }
  }
  
  // 检查 Bearer Token（前端用这种方式）
  const bearerToken = getBearerToken(request);
  if (bearerToken) {
    const sessionData = await getSessionUser(bearerToken, env);
    if (sessionData) {
      return { authenticated: true, reason: 'bearer', token: bearerToken, userId: sessionData.userId };
    }
  }
  
  return { authenticated: false };
}
