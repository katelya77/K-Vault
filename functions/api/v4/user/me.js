/**
 * v4 API - 获取当前用户信息
 */

import { verifySession } from '../../../utils/auth.js';

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

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return cloudreveError(40020, 'Not authenticated');
    }

    const token = authHeader.replace('Bearer ', '');
    const isValid = await verifySession(token, env);

    if (!isValid) {
      return cloudreveError(40020, 'Invalid session');
    }

    const configuredUsername = env.BASIC_USER || 'admin';
    const configuredEmail = env.ADMIN_EMAIL || '';

    return cloudreveSuccess({
      id: '1',
      email: configuredEmail || `${configuredUsername}@localhost`,
      nickname: configuredUsername,
      created_at: new Date().toISOString(),
      group: {
        id: 'admin',
        name: 'Administrator',
        permission: generateAdminPermission(),
      },
    });

  } catch (error) {
    console.error('Get user error:', error);
    return cloudreveError(500, 'Failed to get user info');
  }
}
