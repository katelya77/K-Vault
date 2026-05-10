import { requireJwtAuth, createJwtAuthResponse } from '../../../utils/jwt-auth.js';

function cloudreveSuccess(data) {
  return new Response(JSON.stringify({ code: 0, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context) {
  const { env } = context;

  const authResult = await requireJwtAuth(context.request, env);
  if (!authResult.authorized) {
    return createJwtAuthResponse(authResult.error, authResult.statusCode);
  }

  if (!env.DB) {
    return cloudreveSuccess({ rescanned: false, used: 0, error: 'D1 (DB) 未绑定' });
  }

  let used = 0;
  try {
    const result = await env.DB.prepare(
      'SELECT COALESCE(SUM(file_size), 0) as used FROM files'
    ).first();
    used = Number(result?.used || 0);
  } catch (e) {
    return cloudreveSuccess({ rescanned: false, used: 0, error: e.message });
  }

  if (env.img_url) {
    try {
      await env.img_url.put('capacity:used', String(used));
    } catch (e) {
      // ignore
    }
  }

  return cloudreveSuccess({ rescanned: true, used });
}
