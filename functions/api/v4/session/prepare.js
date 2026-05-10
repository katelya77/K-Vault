/**
 * v4 API - 登录准备
 * 返回可用的登录方式
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
  const { env } = context;
  const hasAuth = env.BASIC_USER && env.BASIC_PASS;

  return cloudreveSuccess({
    webauthn_enabled: false,
    sso_enabled: false,
    password_enabled: hasAuth ? true : false,
    qq_enabled: false,
  });
}
