/**
 * v4 API - 登录令牌
 * 处理用户登录并返回令牌
 */

import {
  createSession,
  createSessionCookieHeader,
  isAuthRequired
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

function generateAdminPermission() {
  const bytes = new Uint8Array(8);
  bytes[0] = 0b11111111;
  bytes[1] = 0b11111111;
  bytes[2] = 0b11111111;
  bytes[3] = 0b11111111;
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
    const password = String(body?.password ?? '');

    if (!email || !password) {
      return cloudreveError(400, 'Missing email or password');
    }

    const configuredUsername = env.BASIC_USER || '';
    const configuredEmail = env.ADMIN_EMAIL || '';

    const isValidUser = email === configuredUsername ||
                        (configuredEmail && email === configuredEmail);
    const isValidPassword = password === env.BASIC_PASS;

    if (isValidUser && isValidPassword) {
      const sessionToken = await createSession(configuredUsername, env);

      const loginResponse = {
        user: {
          id: '1',
          email: configuredEmail || email,
          nickname: configuredUsername,
          created_at: new Date().toISOString(),
          group: {
            id: 'admin',
            name: 'Administrator',
            permission: generateAdminPermission(),
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
    }

    return cloudreveError(40069, 'Incorrect password');

  } catch (error) {
    console.error('Login error:', error);
    return cloudreveError(500, 'Login failed: ' + error.message);
  }
}
