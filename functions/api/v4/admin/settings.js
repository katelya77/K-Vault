/**
 * v4 API - 管理员设置
 */

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

export async function onRequestPost(context) {
  const { request } = context;

  try {
    const body = await request.json();
    const keys = body?.keys || [];

    const result = {};
    for (const key of keys) {
      result[key] = DEFAULT_SETTINGS[key] || '';
    }

    return cloudreveSuccess(result);
  } catch (error) {
    console.error('Get settings error:', error);
    return cloudreveSuccess({});
  }
}
