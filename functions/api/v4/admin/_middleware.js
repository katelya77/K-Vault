/**
 * v4 Admin Middleware
 * 校验 session → 查 users 表 → group !== 'admin' 返回 403
 */

import { getSessionUserFromRequest } from '../../../utils/auth.js';

function jsonResponse(body, status = 200) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  return new Response(JSON.stringify(body), { status, headers });
}

export async function onRequest(context) {
  const { request, env, data } = context;

  const userId = await getSessionUserFromRequest(request, env);
  if (!userId) {
    return jsonResponse({ code: 401, msg: '请先登录', error: 'Login required' }, 401);
  }

  try {
    const user = await env.DB.prepare(
      "SELECT group FROM users WHERE id = ? LIMIT 1"
    ).bind(userId).first();

    if (!user || user.group !== 'admin') {
      return jsonResponse({ code: 403, msg: '权限不足，仅管理员可访问', error: 'Forbidden' }, 403);
    }

    data.userId = userId;
    data.userGroup = user.group;

    return await context.next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    return jsonResponse({ code: 500, msg: 'Internal server error', error: error.message }, 500);
  }
}
