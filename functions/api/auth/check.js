/**
 * 检查认证状态 API
 * GET /api/auth/check
 */
import {
  checkAuthentication,
  isAuthRequired
} from '../../utils/auth.js';
import { getGuestConfig } from '../../utils/guest.js';

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const guestConfig = getGuestConfig(env);

    // 如果没有配置认证
    if (!isAuthRequired(env)) {
      return new Response(JSON.stringify({
        authenticated: true,
        authRequired: false,
        message: '无需登录',
        guestUpload: guestConfig
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const authResult = await checkAuthentication(context);

    const response = {
      authenticated: authResult.authenticated,
      authRequired: true,
      reason: authResult.reason,
      guestUpload: guestConfig,
      user: null
    };

    // 如果已登录，附加用户信息
    if (authResult.authenticated && authResult.userId) {
      const user = await env.DB.prepare(
        "SELECT id, nickname, email, group, status FROM users WHERE id = ? LIMIT 1"
      ).bind(authResult.userId).first();
      if (user) {
        response.user = {
          id: user.id,
          nick: user.nickname,
          email: user.email,
          group: user.group,
          status: user.status
        };
      }
    }

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Auth check error:', error);
    return new Response(JSON.stringify({
      authenticated: false,
      authRequired: true,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
