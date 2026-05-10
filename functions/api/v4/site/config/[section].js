/**
 * v4 API - 站点配置
 */

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

export async function onRequestGet(context) {
  const { params } = context;
  const section = params?.section || 'basic';

  let config;
  switch (section) {
    case 'basic':
      config = DEFAULT_BASIC_CONFIG;
      break;
    case 'login':
      config = DEFAULT_LOGIN_CONFIG;
      break;
    case 'explorer':
      config = DEFAULT_EXPLORER_CONFIG;
      break;
    default:
      config = {};
  }

  return cloudreveSuccess(config);
}
