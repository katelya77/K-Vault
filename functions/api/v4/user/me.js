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

function fmtTime(ts) {
  return new Date(ts).toISOString();
}

async function checkAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '');
  return await verifySession(token, env);
}

async function getUser(env) {
  const row = await env.DB.prepare("SELECT * FROM users WHERE id = '1'").first();
  if (!row) return null;
  const settings = row.settings_json ? JSON.parse(row.settings_json) : {};
  return {
    id: row.id,
    email: row.email || '',
    nickname: row.nickname || '',
    preferred_theme: row.preferred_theme || '',
    language: row.language || '',
    disable_view_sync: settings.disable_view_sync || false,
    share_links_in_profile: settings.share_links_in_profile || 0,
    created_at: fmtTime(row.created_at),
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    if (!(await checkAuth(request, env))) {
      return cloudreveError(40020, 'Invalid session');
    }

    const user = await getUser(env) || {
      id: '1',
      email: '',
      nickname: env.BASIC_USER || 'admin',
      created_at: new Date().toISOString(),
    };

    return cloudreveSuccess({
      ...user,
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
    const now = Date.now();

    const row = await env.DB.prepare("SELECT * FROM users WHERE id = '1'").first();

    if (row) {
      const nickname = body.nickname !== undefined ? body.nickname : row.nickname;
      const email = body.email !== undefined ? body.email : row.email;
      await env.DB.prepare("UPDATE users SET nickname = ?, email = ?, updated_at = ? WHERE id = '1'")
        .bind(nickname, email, now).run();
    } else {
      await env.DB.prepare("INSERT INTO users (id, nickname, email, created_at, updated_at) VALUES ('1', ?, ?, ?, ?)")
        .bind(body.nickname || '', body.email || '', now, now).run();
    }

    return cloudreveSuccess({
      id: '1',
      email: body.email || '',
      nickname: body.nickname || '',
      updated_at: fmtTime(now),
    });
  } catch (error) {
    console.error('Update user error:', error);
    return cloudreveError(500, 'Failed to update user info');
  }
}
