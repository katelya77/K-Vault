/**
 * JWT 鉴权工具
 * 用于保护管理 API 端点
 * 
 * JWT_SECRET 为空时，受保护端点返回 503
 * JWT_SECRET 设置后，请求需携带 ?token=xxx 或 Authorization: Bearer xxx
 */

export function extractToken(request) {
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  
  const url = new URL(request.url);
  const tokenFromQuery = url.searchParams.get('token');
  if (tokenFromQuery) {
    return tokenFromQuery;
  }
  
  return null;
}

export function isJwtAuthEnabled(env) {
  return !!env.JWT_SECRET;
}

export async function requireJwtAuth(request, env) {
  if (!isJwtAuthEnabled(env)) {
    return { 
      authorized: false, 
      error: 'JWT authentication is not enabled. Set JWT_SECRET to enable.',
      statusCode: 503
    };
  }
  
  const token = extractToken(request);
  if (!token) {
    return { 
      authorized: false, 
      error: 'Missing token. Use ?token=xxx or Authorization: Bearer xxx',
      statusCode: 401
    };
  }
  
  if (token !== env.JWT_SECRET) {
    return { 
      authorized: false, 
      error: 'Invalid token',
      statusCode: 401
    };
  }
  
  return { authorized: true };
}

export function createJwtAuthResponse(error, statusCode = 401) {
  return new Response(JSON.stringify({
    success: false,
    error: error,
    errorCode: 'AUTH_REQUIRED'
  }), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' }
  });
}
