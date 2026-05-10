export async function onRequestPost(context) {
  return new Response(
    JSON.stringify({ code: 0, data: { uploaded: true } }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
