export async function onRequestGet(context) {
  const { env } = context;

  let config = {};
  if (env.DB) {
    try {
      const rows = await env.DB.prepare("SELECT key, value FROM config").all();
      if (rows.results) {
        for (const r of rows.results) {
          let val = r.value;
          if (typeof val === 'string' && (val.startsWith('[') || val.startsWith('{'))) {
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
