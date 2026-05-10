/**
 * v4 API - 用户设置
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

export async function onRequestGet(context) {
  return cloudreveSuccess({
    version_retention_enabled: false,
    version_retention_ext: [],
    version_retention_max: 0,
    passwordless: false,
    two_fa_enabled: false,
    passkeys: [],
    disable_view_sync: false,
    share_links_in_profile: 0,
    oauth_grants: [],
  });
}
