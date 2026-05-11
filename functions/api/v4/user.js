/**
 * 用户注册 API
 * POST /api/v4/user
 */
import { hashPassword } from '../../utils/auth.js';

function cloudreveSuccess(data) {
  return new Response(
    JSON.stringify({ code: 0, data: data }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }
  );
}

function cloudreveError(code, message) {
  return new Response(
    JSON.stringify({ code: code, msg: message }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }
  );
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const email = String(body?.email ?? '').trim().toLowerCase();
    const password = String(body?.password ?? '');

    if (!email || !password) {
      return cloudreveError(400, 'Missing email or password');
    }

    if (password.length < 6) {
      return cloudreveError(400, 'Password must be at least 6 characters');
    }

    const allowedEmail = (env.ADMIN_EMAIL || '').trim().toLowerCase();
    if (!allowedEmail) {
      return cloudreveError(400, 'Registration is closed');
    }
    if (email !== allowedEmail) {
      return cloudreveError(400, 'This email is not allowed to register');
    }

    const existingUser = await env.DB.prepare(
      "SELECT id FROM users WHERE email = ? LIMIT 1"
    ).bind(email).first();

    if (existingUser) {
      return cloudreveError(400, 'Email already registered');
    }

    const userCount = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM users"
    ).first();

    const isFirstUser = userCount.count === 0;

    const id = crypto.randomUUID();
    const now = Date.now();
    const pwdHash = await hashPassword(password);
    const group = isFirstUser ? 'admin' : 'user';
    const nick = email.split('@')[0];

    await env.DB.prepare(
      "INSERT INTO users (id, nickname, email, pwd, group, status, storage_capacity, storage_used, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', 0, 0, ?, ?)"
    ).bind(id, nick, email, pwdHash, group, now, now).run();

    return cloudreveSuccess({
      id: id,
      email: email,
      nickname: nick,
      group: group,
      status: 'active',
    });

  } catch (error) {
    console.error('Register error:', error);
    return cloudreveError(500, 'Register failed: ' + error.message);
  }
}
