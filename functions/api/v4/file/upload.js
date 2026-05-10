function cloudreveSuccess(data) {
  return new Response(
    JSON.stringify({ code: 0, data }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  );
}

export async function onRequestPut(context) {
  const body = await context.request.json();
  const sessionId = crypto.randomUUID();
  const now = Date.now();

  return cloudreveSuccess({
    session_id: sessionId,
    expires: now + 86400000,
    chunk_size: 4194304,
    upload_urls: [],
    credential: '',
    uploadID: sessionId,
    callback: '',
    ak: '',
    keyTime: '',
    path: body.uri || '/',
    completeURL: '',
    uri: body.uri || '/',
    callback_secret: '',
    mime_type: body.mime_type || '',
    storage_policy: {
      id: body.policy_id || 'default',
      name: 'Upload',
      type: 'local',
    },
  });
}

export async function onRequestDelete(context) {
  return cloudreveSuccess({ deleted: true });
}
