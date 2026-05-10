/**
 * 登录 API
 * POST /api/auth/login
 * 支持用户名和邮箱登录
 */
import { 
  createSession, 
  createSessionCookieHeader,
  isAuthRequired 
} from '../../utils/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // 如果没有配置认证，返回成功
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
    const username = String(body?.username ?? body?.user ?? '').trim();
    const email = String(body?.email ?? '').trim();
    const password = String(body?.password ?? body?.pass ?? '');

    // 支持用户名或邮箱登录
    const loginIdentifier = username || email;

    if (!loginIdentifier || password === '') {
      return new Response(JSON.stringify({
        success: false,
        message: 'Missing username/email or password.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 获取配置的用户名和邮箱
    const configuredUsername = env.BASIC_USER || '';
    const configuredEmail = env.ADMIN_EMAIL || '';

    // 验证凭据（支持用户名或邮箱）
    const isValidUser = loginIdentifier === configuredUsername || 
                        (configuredEmail && loginIdentifier === configuredEmail);
    const isValidPassword = password === env.BASIC_PASS;

    if (isValidUser && isValidPassword) {
      // 创建会话
      const sessionToken = await createSession(configuredUsername, env);
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: '登录成功' 
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Set-Cookie': createSessionCookieHeader(sessionToken)
        }
      });
    }

    return new Response(JSON.stringify({ 
      success: false, 
      message: '用户名/邮箱或密码错误' 
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
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
