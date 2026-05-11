function generatePermission(isAdmin) {
  const bytes = new Uint8Array(8);
  if (isAdmin) {
    bytes[0] = 0b11111111;
    bytes[1] = 0b11111111;
    bytes[2] = 0b11111111;
    bytes[3] = 0b11111111;
  } else {
    bytes[0] = 0b11111111;
    bytes[1] = 0b11111111;
    bytes[2] = 0b00000000;
    bytes[3] = 0b00000000;
  }
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

async function getUser(userId, env) {
  const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();
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
  const { env, data } = context;

  const userId = data?.userId;
  if (!userId) {
    return cloudreveError(40020, 'Invalid session');
  }

  try {
    const user = await getUser(userId, env);
    if (!user) {
      return cloudreveError(404, '用户不存在');
    }

    const row = await env.DB.prepare(
      "SELECT group FROM users WHERE id = ? LIMIT 1"
    ).bind(userId).first();
    const userGroup = row?.group || 'user';
    const isAdmin = userGroup === 'admin';

    return cloudreveSuccess({
      ...user,
      group: {
        id: userGroup,
        name: isAdmin ? 'Administrator' : 'User',
        permission: generatePermission(isAdmin),
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    return cloudreveError(500, 'Failed to get user info');
  }
}

export async function onRequestPut(context) {
  const { request, env, data } = context;

  const userId = data?.userId;
  if (!userId) {
    return cloudreveError(40020, 'Invalid session');
  }

  try {
    const body = await request.json();
    const now = Date.now();

    const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();

    if (row) {
      const nickname = body.nickname !== undefined ? body.nickname : row.nickname;
      const email = body.email !== undefined ? body.email : row.email;
      await env.DB.prepare("UPDATE users SET nickname = ?, email = ?, updated_at = ? WHERE id = ?")
        .bind(nickname, email, now, userId).run();
    } else {
      await env.DB.prepare("INSERT INTO users (id, nickname, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(userId, body.nickname || '', body.email || '', now, now).run();
    }

    return cloudreveSuccess({
      id: userId,
      email: body.email || '',
      nickname: body.nickname || '',
      updated_at: fmtTime(now),
    });
  } catch (error) {
    console.error('Update user error:', error);
    return cloudreveError(500, 'Failed to update user info');
  }
}
