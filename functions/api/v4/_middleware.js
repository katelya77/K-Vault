/**
 * v4 API - CORS 中间件 + 鉴权
 */

import { checkAuthentication, isAuthRequired } from '../../utils/auth.js';

const PUBLIC_PATHS = [
  '/api/v4/session/token',
  '/api/v4/session/token/refresh',
  '/api/v4/session/token/2fa',
  '/api/v4/session/prepare',
  '/api/v4/site/config/explorer',
  '/api/v4/site/captcha',
];

function isPublicPath(pathname) {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '?') || pathname.startsWith(p + '#'));
}

function addCorsHeaders(headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  headers.set('Access-Control-Max-Age', '86400');
  return headers;
}

function jsonResponse(body, status = 200) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  addCorsHeaders(headers);
  return new Response(JSON.stringify(body), { status, headers });
}

export async function onRequest(context) {
  const { request } = context;
  
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: addCorsHeaders(new Headers()),
    });
  }

  const url = new URL(request.url);
  if (!isPublicPath(url.pathname)) {
    if (isAuthRequired(context.env)) {
      const authResult = await checkAuthentication(context);
      if (!authResult.authenticated) {
        return jsonResponse({ code: 401, msg: '请先登录', error: 'Login required' }, 401);
      }
    }
  }
  
  const response = await context.next();
  
  const newHeaders = new Headers(response.headers);
  addCorsHeaders(newHeaders);
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
