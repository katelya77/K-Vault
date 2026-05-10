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
  const { env } = context;
  const url = new URL(context.request.url);
  const generate = url.searchParams.get('generate') === 'true';
  
  let metricsSummary = undefined;
  
  if (generate && env.DB) {
    try {
      const db = env.DB;
      
      const [fileCountResult, fileSizeResult, folderCountResult, shareCountResult] = await db.batch([
        db.prepare('SELECT COUNT(*) as total FROM files'),
        db.prepare('SELECT COALESCE(SUM(file_size), 0) as total_size FROM files'),
        db.prepare('SELECT COUNT(*) as total FROM folders WHERE id != ?').bind('root'),
        db.prepare('SELECT COUNT(*) as total FROM shares'),
      ]);
      
      const fileTotal = fileCountResult.results?.[0]?.total || 0;
      const folderTotal = folderCountResult.results?.[0]?.total || 0;
      const totalSize = fileSizeResult.results?.[0]?.total_size || 0;
      const shareTotal = shareCountResult.results?.[0]?.total || 0;
      
      metricsSummary = {
        dates: [],
        files: [],
        users: [],
        shares: [],
        file_total: fileTotal + folderTotal,
        user_total: 1,
        share_total: shareTotal,
        entities_total: fileTotal,
        generated_at: new Date().toISOString(),
      };
      
      if (totalSize > 0) {
        metricsSummary.total_size = totalSize;
      }
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
    }
  }
  
  return cloudreveSuccess({
    version: {
      version: '1.0.0',
      commit: 'k-vault',
      pro: true,
    },
    site_urls: [url.origin],
    metrics_summary: metricsSummary,
  });
}
