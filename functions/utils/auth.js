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
 * 验证 Basic Auth 凭据
 */
export function verifyBasicAuth(request, env) {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return null;

  const [scheme, encoded] = authorization.split(' ');
  if (!encoded || scheme !== 'Basic') return null;

  try {
    const buffer = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const decoded = new TextDecoder().decode(buffer).normalize();
    const index = decoded.indexOf(':');
    
    if (index === -1 || /[\0-\x1F\x7F]/.test(decoded)) return null;

    const user = decoded.substring(0, index);
    const pass = decoded.substring(index + 1);

    if (env.BASIC_USER === user && env.BASIC_PASS === pass) {
      return { user, authenticated: true };
    }
  } catch (e) {
    console.error('Basic auth decode error:', e);
  }
  return null;
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
export async function createSession(user, env) {
  const token = generateSessionToken();
  const sessionData = {
    user,
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
 * 检查是否需要认证
 */
export function isAuthRequired(env) {
  return env.BASIC_USER && env.BASIC_PASS;
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
  if (sessionToken && await verifySession(sessionToken, env)) {
    return { authenticated: true, reason: 'session', token: sessionToken };
  }
  
  // 检查 Bearer Token（前端用这种方式）
  const bearerToken = getBearerToken(request);
  if (bearerToken && await verifySession(bearerToken, env)) {
    return { authenticated: true, reason: 'bearer', token: bearerToken };
  }
  
  // 检查 Basic Auth
  const basicAuth = verifyBasicAuth(request, env);
  if (basicAuth) {
    return { authenticated: true, reason: 'basic-auth', user: basicAuth.user };
  }
  
  return { authenticated: false };
}
