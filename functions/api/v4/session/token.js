/**
 * v4 API - 登录令牌
 * 处理用户登录并返回令牌
 */

import {
  createSession,
  createSessionCookieHeader,
  createClearSessionCookieHeader,
  deleteSession,
  isAuthRequired,
  verifyPassword
} from '../../../utils/auth.js';

function cloudreveSuccess(data) {
  return new Response(
    JSON.stringify({
      code: 0,
      data: data,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  );
}

function cloudreveError(code, message) {
  return new Response(
    JSON.stringify({
      code: code,
      msg: message,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  );
}

function generatePermission(isAdmin) {
  const bytes = new Uint8Array(8);
  if (isAdmin) {
    bytes[0] = 0b11111111;
    bytes[1] = 0b11111111;
    bytes[2] = 0b11111111;
    bytes[3] = 0b11111111;
  } else {
    bytes[0] = 0b00111100;
    bytes[1] = 0b00000000;
    bytes[2] = 0b00000000;
    bytes[3] = 0b00000000;
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!isAuthRequired(env)) {
      return cloudreveError(400, 'Login not required');
    }

    const body = await request.json();
    const email = String(body?.email ?? '').trim();
    const password = String(body?.password ?? body?.pass ?? '');

    if (!email || !password) {
      return cloudreveError(400, 'Missing email or password');
    }

    // 查 DB 用户
    const user = await env.DB.prepare(
      "SELECT id, email, nickname, pwd, \"group\", status, created_at FROM users WHERE email = ? LIMIT 1"
    ).bind(email).first();

    if (!user) {
      return cloudreveError(40069, 'Incorrect password');
    }

    if (user.status !== 'active') {
      return cloudreveError(40069, 'Account is disabled');
    }

    if (!user.pwd) {
      return cloudreveError(40069, 'Incorrect password');
    }

    if (!(await verifyPassword(password, user.pwd))) {
      return cloudreveError(40069, 'Incorrect password');
    }

    const sessionToken = await createSession(user.id, env);
    const isAdmin = user.group === 'admin';

    const loginResponse = {
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        created_at: user.created_at,
        group: {
          id: user.group,
          name: isAdmin ? 'Administrator' : 'User',
          permission: generatePermission(isAdmin),
        },
      },
      token: {
        access_token: sessionToken,
        refresh_token: sessionToken,
        access_expires: new Date(Date.now() + 86400000).toISOString(),
        refresh_expires: new Date(Date.now() + 604800000).toISOString(),
      },
    };

    const response = cloudreveSuccess(loginResponse);
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Set-Cookie', createSessionCookieHeader(sessionToken));

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });

  } catch (error) {
    console.error('Login error:', error);
    return cloudreveError(500, 'Login failed: ' + error.message);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const refreshToken = body?.refresh_token || body?.access_token;

    if (refreshToken) {
      await deleteSession(refreshToken, env);
    }

    const response = cloudreveSuccess({});
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Set-Cookie', createClearSessionCookieHeader());

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  } catch (error) {
    return cloudreveSuccess({});
  }
}
