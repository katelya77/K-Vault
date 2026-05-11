/**
 * v4 API - 站点验证码
 * GET /api/v4/site/captcha
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

export async function onRequestGet() {
  return cloudreveSuccess({
    captcha_type: 'none',
    ticket: '',
    image: '',
  });
}
