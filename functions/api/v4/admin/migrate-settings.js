import { requireJwtAuth, createJwtAuthResponse } from '../../../utils/jwt-auth.js';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequestGet(context) {
  const { env, request } = context;

  const authResult = await requireJwtAuth(request, env);
  if (!authResult.authorized) {
    return createJwtAuthResponse(authResult.error, authResult.statusCode);
  }

  if (!env.DB) {
    return jsonResponse({ success: false, error: 'D1 database not configured' }, 500);
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action === 'migrate') {
    return await migrateSettings(env);
  }

  return await getSettingsStats(env);
}

async function getSettingsStats(env) {
  try {
    const oldRow = await env.DB.prepare("SELECT value_json FROM app_settings WHERE key = 'admin_settings'").first();
    const configRows = await env.DB.prepare("SELECT COUNT(*) as count FROM config").first();
    const configData = await env.DB.prepare("SELECT key, value FROM config ORDER BY key").all();

    return jsonResponse({
      success: true,
      old_app_settings: {
        exists: !!oldRow,
        keys: oldRow ? Object.keys(JSON.parse(oldRow.value_json)).length : 0,
      },
      new_config: {
        count: configRows?.count || 0,
        keys: configRows?.count > 0 ? (configData.results || []).map(r => r.key) : [],
      },
    });
  } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 500);
  }
}

async function migrateSettings(env) {
  try {
    const oldRow = await env.DB.prepare("SELECT value_json FROM app_settings WHERE key = 'admin_settings'").first();
    if (!oldRow || !oldRow.value_json) {
      return jsonResponse({
        success: false,
        message: '没有找到旧的 admin_settings 数据，无需迁移',
        migrated: 0,
      });
    }

    const settings = JSON.parse(oldRow.value_json);
    const now = Date.now();
    const stmt = env.DB.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)");
    let migrated = 0;

    for (const [key, val] of Object.entries(settings)) {
      await stmt.bind(key, String(val), now).run();
      migrated++;
    }

    await env.DB.prepare("DELETE FROM app_settings WHERE key = 'admin_settings'").run();

    return jsonResponse({
      success: true,
      message: `已迁移 ${migrated} 个设置项到 config 表`,
      migrated,
    });
  } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 500);
  }
}
