import { hashPassword } from '../../../../utils/auth.js';

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

const ORDER_BY_MAP = {
  '': 'id',
  id: 'id',
  nick: 'nickname',
  email: 'email',
  storage: 'storage_capacity',
};

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const page = body.page || 1;
    const page_size = body.page_size || 20;
    const order_by = ORDER_BY_MAP[body.order_by] || 'id';
    const order_direction = body.order_direction === 'asc' ? 'ASC' : 'DESC';
    const conditions = body.conditions || {};

    const offset = (page - 1) * page_size;

    const whereClauses = [];
    const bindValues = [];
    if (conditions.user_email) {
      whereClauses.push('email LIKE ?');
      bindValues.push(`%${conditions.user_email}%`);
    }
    if (conditions.user_nick) {
      whereClauses.push('nickname LIKE ?');
      bindValues.push(`%${conditions.user_nick}%`);
    }
    if (conditions.user_group) {
      whereClauses.push('"group" = ?');
      bindValues.push(conditions.user_group);
    }
    if (conditions.user_status) {
      whereClauses.push('status = ?');
      bindValues.push(conditions.user_status);
    }

    const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const countResult = await env.DB.prepare(`SELECT COUNT(*) as total FROM users ${whereSQL}`).bind(...bindValues).first();
    const total = countResult?.total || 0;

    const orderColumn = order_by === 'id' ? 'CAST(id AS INTEGER)' : `"${order_by}"`;
    const rows = await env.DB.prepare(
      `SELECT id, nickname, email, "group", status, storage_capacity, storage_used, created_at, updated_at FROM users ${whereSQL} ORDER BY ${orderColumn} ${order_direction} LIMIT ? OFFSET ?`
    ).bind(...bindValues, page_size, offset).all();

    const users = (rows.results || []).map(row => ({
      id: parseInt(row.id, 10) || 0,
      nick: row.nickname || '',
      email: row.email || '',
      group: row.group || 'user',
      status: row.status || 'active',
      storage: row.storage_capacity || 0,
      created_at: row.created_at ? new Date(row.created_at).toISOString() : undefined,
      updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
      edges: {},
    }));

    return cloudreveSuccess({
      users,
      pagination: { page, page_size, total_items: total },
    });
  } catch (error) {
    console.error('Get user list error:', error);
    return cloudreveError(1, '获取用户列表失败');
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const userData = body.user || body;

    if (userData.id) {
      return cloudreveError(1, '新建用户不应包含 ID');
    }

    const now = Date.now();
    const id = String(now);
    const nickname = userData.nick || userData.nickname || '';
    const email = userData.email || '';
    const password = body.password || '';
    const userGroup = userData.group || 'user';
    const status = userData.status || 'active';
    const storage_capacity = userData.storage || 0;

    let pwd = '';
    if (password) {
      pwd = await hashPassword(password);
    }

    await env.DB.prepare(
      `INSERT INTO users (id, nickname, email, pwd, "group", status, storage_capacity, storage_used, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).bind(id, nickname, email, pwd, userGroup, status, storage_capacity, now, now).run();

    return cloudreveSuccess({
      id: parseInt(id, 10),
      nick: nickname,
      email,
      group: userGroup,
      status,
      storage: storage_capacity,
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
      edges: {},
    });
  } catch (error) {
    console.error('Create user error:', error);
    return cloudreveError(1, '创建用户失败');
  }
}
