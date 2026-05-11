import { getAvailableChannels } from '../../../utils/storage-health.js';

export async function onRequestGet(context) {
  const { env } = context;

  const channels = await getAvailableChannels(env);

  return new Response(JSON.stringify({ code: 0, data: channels }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
