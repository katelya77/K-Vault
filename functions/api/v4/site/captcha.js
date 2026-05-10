/**
 * v4 API - 站点验证码
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
    captcha_type: 'none',
  });
}
