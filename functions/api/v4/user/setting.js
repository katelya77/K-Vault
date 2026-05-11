const DEFAULT_USER_SETTINGS = {
  version_retention_enabled: false,
  version_retention_ext: [],
  version_retention_max: 0,
  passwordless: false,
  two_fa_enabled: false,
  passkeys: [],
  disable_view_sync: false,
  share_links_in_profile: 0,
  oauth_grants: [],
};

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

async function getUserSettings(userId, env) {
  const row = await env.DB.prepare("SELECT settings_json, preferred_theme, language FROM users WHERE id = ?").bind(userId).first();
  if (!row) return { ...DEFAULT_USER_SETTINGS };
  const settings = row.settings_json ? JSON.parse(row.settings_json) : {};
  return {
    ...DEFAULT_USER_SETTINGS,
    ...settings,
  };
}

export async function onRequestGet(context) {
  const { env, data } = context;

  const userId = data?.userId;
  if (!userId) {
    return cloudreveError(40020, 'Invalid session');
  }

  try {
    const settings = await getUserSettings(userId, env);
    return cloudreveSuccess(settings);
  } catch (error) {
    console.error('Get user settings error:', error);
    return cloudreveSuccess({ ...DEFAULT_USER_SETTINGS });
  }
}

export async function onRequestPatch(context) {
  const { request, env, data } = context;

  const userId = data?.userId;
  if (!userId) {
    return cloudreveError(40020, 'Invalid session');
  }

  try {
    const body = await request.json();
    const now = Date.now();
    const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();

    if (!row) {
      const initialSettings = { ...DEFAULT_USER_SETTINGS };
      const directFields = {};
      const jsonFields = {};
      for (const [key, value] of Object.entries(body)) {
        if (key === 'nick') directFields.nickname = value;
        else if (key === 'language') directFields.language = value;
        else if (key === 'preferred_theme') directFields.preferred_theme = value;
        else jsonFields[key] = value;
      }
      Object.assign(initialSettings, jsonFields);
      await env.DB.prepare(
        "INSERT INTO users (id, nickname, language, preferred_theme, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        userId,
        directFields.nickname || '',
        directFields.language || '',
        directFields.preferred_theme || '',
        JSON.stringify(initialSettings),
        now, now
      ).run();
      return cloudreveSuccess({});
    }

    if (body.nick !== undefined) {
      await env.DB.prepare("UPDATE users SET nickname = ?, updated_at = ? WHERE id = ?")
        .bind(body.nick, now, userId).run();
    }

    if (body.language !== undefined) {
      await env.DB.prepare("UPDATE users SET language = ?, updated_at = ? WHERE id = ?")
        .bind(body.language, now, userId).run();
    }

    if (body.preferred_theme !== undefined) {
      await env.DB.prepare("UPDATE users SET preferred_theme = ?, updated_at = ? WHERE id = ?")
        .bind(body.preferred_theme, now, userId).run();
    }

    const SETTING_KEYS = [
      'version_retention_enabled', 'version_retention_ext', 'version_retention_max',
      'disable_view_sync', 'share_links_in_profile',
    ];
    const hasJsonKeys = SETTING_KEYS.some(k => body[k] !== undefined);
    if (hasJsonKeys) {
      const current = row.settings_json ? JSON.parse(row.settings_json) : {};
      for (const key of SETTING_KEYS) {
        if (body[key] !== undefined) {
          current[key] = body[key];
        }
      }
      await env.DB.prepare("UPDATE users SET settings_json = ?, updated_at = ? WHERE id = ?")
        .bind(JSON.stringify(current), now, userId).run();
    }

    return cloudreveSuccess({});
  } catch (error) {
    console.error('Update user settings error:', error);
    return cloudreveError(500, 'Failed to update settings');
  }
}
