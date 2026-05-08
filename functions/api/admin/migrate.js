/**
 * 数据库迁移 API - 从 KV 迁移到 D1
 * 仅管理员可访问
 */

import { runMigration } from '../../scripts/migrate-kv-to-db.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!env.DB) {
      return new Response(JSON.stringify({
        success: false,
        error: 'D1 database not configured',
        errorCode: 'DB_NOT_CONFIGURED'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!env.img_url) {
      return new Response(JSON.stringify({
        success: false,
        error: 'KV binding not configured',
        errorCode: 'KV_NOT_CONFIGURED'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json().catch(() => ({}));
    const options = {
      migrateFiles: body.migrateFiles !== false,
      migrateShares: body.migrateShares !== false,
      migrateTokens: body.migrateTokens !== false,
      migrateStorageConfigs: body.migrateStorageConfigs !== false
    };

    console.log('Starting migration with options:', options);

    const result = await runMigration(env.img_url, env.DB, options);

    if (result.success) {
      return new Response(JSON.stringify({
        success: true,
        message: 'Migration completed successfully',
        results: {
          files: result.results.files,
          shares: result.results.shares,
          tokens: result.results.tokens,
          storageConfigs: result.results.storageConfigs
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      return new Response(JSON.stringify({
        success: false,
        error: result.error,
        results: result.results
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    console.error('Migration error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      errorCode: 'MIGRATION_ERROR'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestGet(context) {
  const { env } = context;

  try {
    if (!env.DB) {
      return new Response(JSON.stringify({
        success: false,
        error: 'D1 database not configured',
        errorCode: 'DB_NOT_CONFIGURED'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const stats = {
      files: 0,
      folders: 0,
      shares: 0,
      tokens: 0,
      storageConfigs: 0
    };

    const filesCount = await env.DB.prepare('SELECT COUNT(*) as count FROM files').first();
    stats.files = filesCount?.count || 0;

    const foldersCount = await env.DB.prepare('SELECT COUNT(*) as count FROM folders').first();
    stats.folders = foldersCount?.count || 0;

    const sharesCount = await env.DB.prepare('SELECT COUNT(*) as count FROM shares').first();
    stats.shares = sharesCount?.count || 0;

    const tokensCount = await env.DB.prepare('SELECT COUNT(*) as count FROM api_tokens').first();
    stats.tokens = tokensCount?.count || 0;

    const storageConfigsCount = await env.DB.prepare('SELECT COUNT(*) as count FROM storage_configs').first();
    stats.storageConfigs = storageConfigsCount?.count || 0;

    return new Response(JSON.stringify({
      success: true,
      stats,
      hasKV: Boolean(env.img_url),
      hasD1: Boolean(env.DB)
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Stats error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      errorCode: 'STATS_ERROR'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
