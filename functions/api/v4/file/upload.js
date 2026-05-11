function cloudreveSuccess(data) {
  return new Response(JSON.stringify({ code: 0, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPut(context) {
  const { env, request } = context;

  try {
    const body = await request.json();
    const sessionId = crypto.randomUUID();
    const now = Date.now();

    const fileName = body.uri ? body.uri.split('/').filter(Boolean).pop() || 'unnamed' : 'unnamed';

    const sessionInfo = {
      uri: body.uri || '/',
      size: body.size || 0,
      mime_type: body.mime_type || '',
      file_name: fileName,
      policy_id: body.policy_id || 'default',
      entity_type: body.entity_type || '',
      last_modified: body.last_modified || now,
      channel: body.channel || '',
      created_at: now,
    };

    if (env.img_url) {
      await env.img_url.put('tmp:sess:' + sessionId, JSON.stringify(sessionInfo), {
        expirationTtl: 86400,
      });
    }

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
        name: 'Default Storage',
        type: 'local',
        max_size: 11544872091648,
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ code: 500, error: error.message, msg: '创建上传会话失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function onRequestDelete(context) {
  const { env, request } = context;

  try {
    const body = await request.json();
    if (body.id && env.img_url) {
      await env.img_url.delete('tmp:sess:' + body.id);
      await env.img_url.delete('tmp:file:' + body.id);
    }
    return cloudreveSuccess({ deleted: true });
  } catch {
    return cloudreveSuccess({ deleted: true });
  }
}
