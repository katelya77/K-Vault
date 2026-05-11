import { verifySession } from '../../../utils/auth.js';

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

const DEFAULT_SETTINGS = {
  siteName: 'K-Vault',
  siteDes: 'A simple file storage system',
  siteURL: '',
  siteScript: '',
  pwa_small_icon: '',
  pwa_medium_icon: '',
  pwa_large_icon: '',
  site_logo: '/favicon.svg',
  site_logo_light: '/favicon.svg',
  tos_url: '',
  privacy_policy_url: '',
  show_app_promotion: 'false',
  show_desktop_app_promotion: 'false',
  register_enabled: 'false',
  email_active: 'false',
  default_group: '1',
  authn_enabled: 'false',
  avatar_path: '',
  avatar_size: '2097152',
  avatar_size_l: '5242880',
  gravatar_server: 'https://www.gravatar.com/avatar/',
  login_captcha: 'false',
  reg_captcha: 'false',
  forget_captcha: 'false',
  captcha_type: 'normal',
  mail_keepalive: 'false',
  fromAdress: '',
  smtpHost: '',
  smtpPort: '25',
  replyTo: '',
  smtpUser: '',
  smtpPass: '',
  smtpEncryption: 'none',
  fromName: 'K-Vault',
  mail_activation_template: '',
  mail_reset_template: '',
  theme_options: '[]',
  defaultTheme: 'default',
  custom_nav_items: '[]',
  headless_footer_html: '',
  headless_bottom_html: '',
  sidebar_bottom_html: '',
  temp_path: '/tmp',
  siteID: 'k-vault',
  cron_garbage_collect: '0',
  hash_id_salt: '',
  access_token_ttl: '86400',
  refresh_token_ttl: '604800',
};

async function checkAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '');
  const result = await verifySession(token, env);
  return result.valid;
}

async function getAllSettings(env) {
  const rows = await env.DB.prepare("SELECT key, value FROM config").all();
  const stored = {};
  if (rows.results) {
    for (const r of rows.results) {
      stored[r.key] = r.value;
    }
  }
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!(await checkAuth(request, env))) {
      return cloudreveError(40020, 'Invalid session');
    }

    const body = await request.json();
    const keys = body?.keys || [];
    const all = await getAllSettings(env);

    const result = {};
    for (const key of keys) {
      result[key] = all[key] !== undefined ? all[key] : '';
    }

    return cloudreveSuccess(result);
  } catch (error) {
    console.error('Get settings error:', error);
    return cloudreveSuccess({});
  }
}

export async function onRequestPatch(context) {
  const { request, env } = context;

  try {
    if (!(await checkAuth(request, env))) {
      return cloudreveError(40020, 'Invalid session');
    }

    const body = await request.json();
    const updates = body?.settings || body || {};

    const stmt = env.DB.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)");
    const now = Date.now();

    for (const key of Object.keys(updates)) {
      if (key in DEFAULT_SETTINGS) {
        await stmt.bind(key, String(updates[key]), now).run();
      }
    }

    return cloudreveSuccess({});
  } catch (error) {
    console.error('Update settings error:', error);
    return cloudreveError(500, 'Failed to update settings');
  }
}
