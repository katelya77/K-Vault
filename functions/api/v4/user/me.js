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

async function checkAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '');
  return await verifySession(token, env);
}

async function getProfile(env) {
  const stored = await env.img_url.get('user:profile', { type: 'json' });
  const configuredUsername = env.BASIC_USER || 'admin';
  const configuredEmail = env.ADMIN_EMAIL || '';
  return {
    nickname: stored?.nickname || configuredUsername,
    email: stored?.email || configuredEmail || `${configuredUsername}@localhost`,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    if (!(await checkAuth(request, env))) {
      return cloudreveError(40020, 'Invalid session');
    }

    const profile = await getProfile(env);

    return cloudreveSuccess({
      id: '1',
      email: profile.email,
      nickname: profile.nickname,
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

export async function onRequestPut(context) {
  const { request, env } = context;

  try {
    if (!(await checkAuth(request, env))) {
      return cloudreveError(40020, 'Invalid session');
    }

    const body = await request.json();
    const current = await env.img_url.get('user:profile', { type: 'json' }) || {};

    if (body.nickname !== undefined) current.nickname = body.nickname;
    if (body.email !== undefined) current.email = body.email;

    await env.img_url.put('user:profile', JSON.stringify(current));

    return cloudreveSuccess({
      id: '1',
      email: current.email || '',
      nickname: current.nickname || '',
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Update user error:', error);
    return cloudreveError(500, 'Failed to update user info');
  }
}
