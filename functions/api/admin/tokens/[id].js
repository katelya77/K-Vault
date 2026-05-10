/**
 * API Token 管理（单个） - 仅在 Docker 模式下可用
 * Cloudflare Pages 模式下返回错误信息
 */

export async function onRequest(context) {
  return new Response(JSON.stringify({
    error: 'API Token management is only available in Docker mode',
    errorCode: 'DOCKER_ONLY',
    message: 'Please use Docker deployment to access this feature'
  }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  });
}
