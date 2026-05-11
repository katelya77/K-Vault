/**
 * 登录 API
 * POST /api/auth/login
 * 支持邮箱 + 密码登录
 */
import {
  createSession,
  createSessionCookieHeader,
  isAuthRequired,
  verifyPassword
} from '../../utils/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!isAuthRequired(env)) {
      return new Response(JSON.stringify({
        success: true,
        message: '无需登录',
        authRequired: false
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const email = String(body?.email ?? body?.user ?? body?.username ?? '').trim();
    const password = String(body?.password ?? body?.pass ?? '');

    if (!email || !password) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Missing email or password.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const user = await env.DB.prepare(
      "SELECT id, email, nickname, pwd, status FROM users WHERE email = ? LIMIT 1"
    ).bind(email).first();

    if (!user || !user.pwd || !(await verifyPassword(password, user.pwd))) {
      return new Response(JSON.stringify({
        success: false,
        message: '邮箱或密码错误'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (user.status !== 'active') {
      return new Response(JSON.stringify({
        success: false,
        message: '账户已被禁用'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const sessionToken = await createSession(user.id, env);

    return new Response(JSON.stringify({
      success: true,
      message: '登录成功'
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': createSessionCookieHeader(sessionToken)
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    return new Response(JSON.stringify({
      success: false,
      message: '登录失败：' + error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 检查登录状态
export async function onRequestGet(context) {
  const { env } = context;

  return new Response(JSON.stringify({
    authRequired: isAuthRequired(env)
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
