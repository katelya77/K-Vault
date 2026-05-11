import { verifySession } from '../../../utils/auth.js';

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

async function checkAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '');
  return await verifySession(token, env);
}

async function getSettings(env) {
  const stored = await env.img_url.get('user:settings', { type: 'json' });
  return { ...DEFAULT_USER_SETTINGS, ...(stored || {}) };
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    if (!(await checkAuth(request, env))) {
      return cloudreveError(40020, 'Invalid session');
    }

    const settings = await getSettings(env);
    return cloudreveSuccess(settings);
  } catch (error) {
    console.error('Get user settings error:', error);
    return cloudreveSuccess(DEFAULT_USER_SETTINGS);
  }
}

export async function onRequestPatch(context) {
  const { request, env } = context;

  try {
    if (!(await checkAuth(request, env))) {
      return cloudreveError(40020, 'Invalid session');
    }

    const body = await request.json();

    if (body.nick !== undefined) {
      const profile = await env.img_url.get('user:profile', { type: 'json' }) || {};
      profile.nickname = body.nick;
      await env.img_url.put('user:profile', JSON.stringify(profile));
    }

    const SETTING_KEYS = [
      'language', 'preferred_theme',
      'version_retention_enabled', 'version_retention_ext', 'version_retention_max',
      'disable_view_sync', 'share_links_in_profile',
    ];

    const hasSettingKeys = SETTING_KEYS.some(k => body[k] !== undefined);
    if (hasSettingKeys) {
      const current = await getSettings(env);
      for (const key of SETTING_KEYS) {
        if (body[key] !== undefined) {
          current[key] = body[key];
        }
      }
      await env.img_url.put('user:settings', JSON.stringify(current));
    }

    return cloudreveSuccess({});
  } catch (error) {
    console.error('Update user settings error:', error);
    return cloudreveError(500, 'Failed to update settings');
  }
}
