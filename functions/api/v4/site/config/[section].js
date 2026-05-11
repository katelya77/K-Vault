export async function onRequestGet(context) {
  const { env } = context;

  let config = {};
  if (env.DB) {
    try {
      const rows = await env.DB.prepare("SELECT key, value FROM config").all();
      if (rows.results) {
        for (const r of rows.results) {
          config[r.key] = r.value;
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
