export async function onRequestPatch(context) {
  return new Response(JSON.stringify({ code: 0 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
