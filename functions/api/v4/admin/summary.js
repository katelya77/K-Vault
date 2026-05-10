/**
 * v4 API - 管理员概览
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
  const url = new URL(context.request.url);
  const generate = url.searchParams.get('generate') === 'true';
  
  return cloudreveSuccess({
    version: {
      version: '1.0.0',
      commit: 'k-vault',
      pro: true,
    },
    site_urls: [url.origin],
    metrics_summary: generate ? {
      dates: [],
      files: [],
      users: [],
      shares: [],
      file_total: 0,
      user_total: 1,
      share_total: 0,
      entities_total: 0,
      generated_at: new Date().toISOString(),
    } : undefined,
  });
}
