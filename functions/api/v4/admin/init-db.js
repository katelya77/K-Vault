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
import { requireJwtAuth, createJwtAuthResponse } from '../../../utils/jwt-auth.js';

export async function onRequestGet(context) {
  const { env } = context;
  
  const authResult = await requireJwtAuth(context.request, env);
  if (!authResult.authorized) {
    return createJwtAuthResponse(authResult.error, authResult.statusCode);
  }
  
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
  const { env } = context;
  
  const authResult = await requireJwtAuth(context.request, env);
  if (!authResult.authorized) {
    return createJwtAuthResponse(authResult.error, authResult.statusCode);
  }
  
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
