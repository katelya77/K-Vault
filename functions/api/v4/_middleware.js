/**
 * v4 API - CORS 中间件
 * 处理 CORS 预检请求和响应头
 */

function addCorsHeaders(headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  headers.set('Access-Control-Max-Age', '86400');
  return headers;
}

export async function onRequest(context) {
  const { request } = context;
  
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: addCorsHeaders(new Headers()),
    });
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
