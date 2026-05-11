const BOOLEAN_KEYS = new Set([
  'login_captcha', 'reg_captcha', 'forget_captcha',
  'register_enabled', 'email_active', 'authn_enabled',
  'show_app_promotion', 'show_desktop_app_promotion',
  'mail_keepalive', 'thumb_gc_after_gen',
  'media_meta_exif', 'media_meta_geocoding',
  'ocr_enabled', 'full_text_search',
  'show_encryption_status', 'passwordless', 'two_fa_enabled',
]);

export async function onRequestGet(context) {
  const { env } = context;

  let config = {};
  if (env.DB) {
    try {
      const rows = await env.DB.prepare("SELECT key, value FROM config").all();
      if (rows.results) {
        for (const r of rows.results) {
          let val = r.value;
          if (BOOLEAN_KEYS.has(r.key)) {
            val = val === 'true' || val === '1';
          } else if (typeof val === 'string' && (val.startsWith('[') || val.startsWith('{'))) {
            try {
              val = JSON.parse(val);
            } catch {
              // keep as string
            }
          }
          config[r.key] = val;
        }
      }
    } catch {
      // ignore
    }
  }

  return new Response(
    JSON.stringify({ code: 0, data: config }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  );
}
