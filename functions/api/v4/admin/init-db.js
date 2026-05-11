/**
 * 数据库初始化和迁移 API
 * 
 * 需要 JWT 鉴权（设置 JWT_SECRET 环境变量）
 * 
 * GET  - 查看数据库状态（?action=status）
 * GET  - 初始化数据库（?action=init）
 * POST - 初始化数据库并执行迁移
 */

import { ensureTablesExist, runAutoMigrations } from '../../../utils/migrations.js';
import { requireJwtAuth } from '../../../utils/jwt-auth.js';
import { checkAuthentication } from '../../../utils/auth.js';

async function checkDualAuth(context) {
  const loginAuth = await checkAuthentication(context);
  if (loginAuth.authenticated) {
    return { authorized: true };
  }
  const jwtAuth = await requireJwtAuth(context.request, context.env);
  if (jwtAuth.authorized) {
    return { authorized: true };
  }
  if (jwtAuth.statusCode === 503) {
    return { authorized: false, error: jwtAuth.error, statusCode: 503 };
  }
  return { authorized: false, error: '请先登录，或使用 JWT_SECRET 鉴权', statusCode: 401 };
}

function createDualAuthResponse(error, statusCode = 401) {
  return new Response(JSON.stringify({
    success: false,
    error,
    errorCode: 'AUTH_REQUIRED'
  }), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequestGet(context) {
  const authResult = await checkDualAuth(context);
  if (!authResult.authorized) {
    return createDualAuthResponse(authResult.error, authResult.statusCode);
  }

  const { env } = context;

  if (!env.DB) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Database not configured',
      errorCode: 'NO_DATABASE'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(context.request.url);
  const action = url.searchParams.get('action');

  if (action === 'init') {
    return await initDatabase(env);
  }

  return await getDatabaseStatus(env);
}

export async function onRequestPost(context) {
  const authResult = await checkDualAuth(context);
  if (!authResult.authorized) {
    return createDualAuthResponse(authResult.error, authResult.statusCode);
  }

  const { env } = context;

  if (!env.DB) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Database not configured',
      errorCode: 'NO_DATABASE'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return await initDatabase(env);
}

async function getDatabaseStatus(env) {
  try {
    const db = env.DB;
    
    const tables = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all();
    
    const columns = {};
    for (const table of tables.results || []) {
      const cols = await db.prepare(
        `SELECT name, type, notnull FROM pragma_table_info('${table.name}')`
      ).all();
      columns[table.name] = cols.results || [];
    }
    
    return new Response(JSON.stringify({
      success: true,
      tables: tables.results || [],
      columns
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function initDatabase(env) {
  try {
    const db = env.DB;
    
    await ensureTablesExist(db);
    
    const migrationResults = await runAutoMigrations(db, env);
    
    return new Response(JSON.stringify({
      success: true,
      message: 'Database initialized successfully',
      migrations: migrationResults
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Database initialization failed:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
