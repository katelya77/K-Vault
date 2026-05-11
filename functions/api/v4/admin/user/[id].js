import { hashPassword } from '../../../../../utils/auth.js';

function cloudreveSuccess(data) {
  return new Response(JSON.stringify({ code: 0, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function cloudreveError(code, message) {
  return new Response(JSON.stringify({ code, msg: message }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context) {
  const { env, params } = context;
  try {
    const id = params.id;
    if (!id) {
      return cloudreveError(1, '缺少用户 ID');
    }

    const row = await env.DB.prepare(
      `SELECT id, nickname, email, "group", status, storage_capacity, storage_used, created_at, updated_at FROM users WHERE id = ? LIMIT 1`
    ).bind(id).first();

    if (!row) {
      return cloudreveError(404, '用户不存在');
    }

    return cloudreveSuccess({
      id: parseInt(row.id, 10) || 0,
      nick: row.nickname || '',
      email: row.email || '',
      group: row.group || 'user',
      status: row.status || 'active',
      storage: row.storage_capacity || 0,
      created_at: row.created_at ? new Date(row.created_at).toISOString() : undefined,
      updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
      edges: {},
    });
  } catch (error) {
    console.error('Get user detail error:', error);
    return cloudreveError(1, '获取用户详情失败');
  }
}

export async function onRequestPut(context) {
  const { request, env, params } = context;
  try {
    const id = params.id;
    if (!id) {
      return cloudreveError(1, '缺少用户 ID');
    }

    const existing = await env.DB.prepare(
      `SELECT id FROM users WHERE id = ? LIMIT 1`
    ).bind(id).first();

    if (!existing) {
      return cloudreveError(404, '用户不存在');
    }

    const body = await request.json();
    const userData = body.user || body;

    const setClauses = [];
    const bindValues = [];

    if (userData.nick !== undefined) {
      setClauses.push('nickname = ?');
      bindValues.push(userData.nick);
    }
    if (userData.email !== undefined) {
      setClauses.push('email = ?');
      bindValues.push(userData.email);
    }
    if (userData.group !== undefined) {
      setClauses.push('"group" = ?');
      bindValues.push(userData.group);
    }
    if (userData.status !== undefined) {
      setClauses.push('status = ?');
      bindValues.push(userData.status);
    }
    if (userData.storage !== undefined) {
      setClauses.push('storage_capacity = ?');
      bindValues.push(userData.storage);
    }

    if (body.password) {
      const pwd = await hashPassword(body.password);
      setClauses.push('pwd = ?');
      bindValues.push(pwd);
    }

    if (setClauses.length > 0) {
      setClauses.push('updated_at = ?');
      bindValues.push(Date.now());
      bindValues.push(id);

      await env.DB.prepare(
        `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`
      ).bind(...bindValues).run();
    }

    const updated = await env.DB.prepare(
      `SELECT id, nickname, email, "group", status, storage_capacity, storage_used, created_at, updated_at FROM users WHERE id = ? LIMIT 1`
    ).bind(id).first();

    return cloudreveSuccess({
      id: parseInt(updated.id, 10) || 0,
      nick: updated.nickname || '',
      email: updated.email || '',
      group: updated.group || 'user',
      status: updated.status || 'active',
      storage: updated.storage_capacity || 0,
      created_at: updated.created_at ? new Date(updated.created_at).toISOString() : undefined,
      updated_at: updated.updated_at ? new Date(updated.updated_at).toISOString() : undefined,
      edges: {},
    });
  } catch (error) {
    console.error('Update user error:', error);
    return cloudreveError(1, '更新用户失败');
  }
}
