/**
 * v4 API - 站点配置
 */

const KEY_MAP = {
  siteName: 'title',
  site_logo: 'logo',
  site_logo_light: 'logo_light',
  theme_options: 'themes',
  defaultTheme: 'default_theme',
  login_captcha: 'login_captcha',
  reg_captcha: 'reg_captcha',
  forget_captcha: 'forget_captcha',
  captcha_type: 'captcha_type',
  register_enabled: 'register_enabled',
  authn_enabled: 'authn',
  show_app_promotion: 'app_promotion',
  show_desktop_app_promotion: 'desktop_app_promotion',
  thumbnail_width: 'thumbnail_width',
  thumbnail_height: 'thumbnail_height',
};

const BOOL_KEYS = new Set([
  'login_captcha', 'reg_captcha', 'forget_captcha',
  'register_enabled', 'authn_enabled',
  'show_app_promotion', 'show_desktop_app_promotion',
]);

const NUM_KEYS = new Set([
  'thumbnail_width', 'thumbnail_height',
]);

const DEFAULT_BASIC_CONFIG = {
  title: 'K-Vault',
  logo: '/favicon.svg',
  logo_light: '/favicon.svg',
  themes: '{}',
  default_theme: 'default',
  instance_id: 'k-vault-instance',
  login_captcha: false,
  reg_captcha: false,
  forget_captcha: false,
  authn: false,
  register_enabled: false,
  captcha_type: 'normal',
  max_batch_size: 10,
  app_promotion: false,
  desktop_app_promotion: false,
  thumbnail_width: 200,
  thumbnail_height: 200,
  show_encryption_status: false,
  full_text_search: false,
};

const DEFAULT_LOGIN_CONFIG = {
  login_captcha: false,
  reg_captcha: false,
  forget_captcha: false,
  captcha_type: 'normal',
  register_enabled: false,
  authn: false,
  title: 'K-Vault',
  logo: '/favicon.svg',
  logo_light: '/favicon.svg',
};

const DEFAULT_EXPLORER_CONFIG = {
  file_viewers: [],
  default_viewer_mapping: {},
  custom_props: [],
  custom_nav_items: [],
  thumb_exts: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'],
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

async function getDbConfig(env) {
  if (!env.DB) return {};
  try {
    const rows = await env.DB.prepare("SELECT key, value FROM config").all();
    const stored = {};
    if (rows.results) {
      for (const r of rows.results) {
        stored[r.key] = r.value;
      }
    }
    return stored;
  } catch {
    return {};
  }
}

function applyOverrides(defaults, dbConfig, keyMap) {
  const result = { ...defaults };
  for (const [dbKey, configKey] of Object.entries(keyMap)) {
    const raw = dbConfig[dbKey];
    if (raw === undefined || raw === null) continue;
    let val = raw;
    if (BOOL_KEYS.has(dbKey)) {
      val = raw === 'true' || raw === true;
    } else if (NUM_KEYS.has(dbKey)) {
      val = Number(raw);
    }
    result[configKey] = val;
  }
  return result;
}

export async function onRequestGet(context) {
  const { params, env } = context;
  const section = params?.section || 'basic';
  const dbConfig = await getDbConfig(env);

  let config;
  switch (section) {
    case 'basic':
      config = applyOverrides(DEFAULT_BASIC_CONFIG, dbConfig, KEY_MAP);
      break;
    case 'login':
      config = applyOverrides(DEFAULT_LOGIN_CONFIG, dbConfig, KEY_MAP);
      break;
    case 'explorer':
      config = DEFAULT_EXPLORER_CONFIG;
      break;
    default:
      config = {};
  }

  return cloudreveSuccess(config);
}
