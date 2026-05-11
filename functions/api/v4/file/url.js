import { generateDownloadToken, ensureUserDownloadSecret, getSessionUserFromRequest } from '../../../utils/auth.js';

function cloudreveSuccess(data) {
  return new Response(JSON.stringify({ code: 0, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function errorResponse(msg, status = 400) {
  return new Response(JSON.stringify({ code: status, msg, error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseUri(raw) {
  if (!raw.startsWith('cloudreve://')) {
    const parts = raw.replace(/^\//, '').split('/').filter(Boolean);
    return { fileName: parts.pop() || '', folderPath: parts.length > 0 ? '/' + parts.join('/') : '' };
  }
  const rest = raw.slice('cloudreve://'.length);
  const idx = rest.indexOf('/');
  if (idx === -1) return { fileName: '', folderPath: '' };
  const pathPart = rest.slice(idx);
  const parts = pathPart.split('/').filter(Boolean);
  return { fileName: parts.pop() || '', folderPath: parts.length > 0 ? '/' + parts.join('/') : '' };
}

async function resolveCurrentUserId(request, env) {
  return await getSessionUserFromRequest(request, env);
}

export async function onRequestPost(context) {
  const { env, request } = context;

  if (!env.DB) {
    return errorResponse('D1 (DB) 未绑定', 500);
  }

  const uid = await resolveCurrentUserId(request, env);
  if (!uid) {
    return new Response(JSON.stringify({ code: 401, msg: '请先登录', error: 'Login required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const secret = await ensureUserDownloadSecret(env, uid);

  try {
    const body = await request.json();
    const uris = body.uris || [];

    if (uris.length === 0) {
      return cloudreveSuccess({ urls: [], expires: '' });
    }

    const urlObj = new URL(request.url);
    const baseUrl = urlObj.origin;

    const results = [];
    for (const uri of uris) {
      const { fileName, folderPath } = parseUri(uri);

      let row = null;
      if (fileName) {
        row = await env.DB.prepare(
          "SELECT id, file_name, file_size FROM files WHERE folder_path = ? AND file_name = ? LIMIT 1"
        ).bind(folderPath, fileName).first();
      }

      if (row) {
        const dlToken = await generateDownloadToken(row.id, row.file_size || 0, secret, uid);
        results.push({
          url: baseUrl + '/api/v4/file/get/' + row.id + `?dl_token=${dlToken.token}&expires=${dlToken.expires}&uid=${dlToken.uid}`,
          name: row.file_name,
        });
      } else {
        results.push({
          url: uri,
          name: fileName || uri,
        });
      }
    }

    return cloudreveSuccess({
      urls: results,
      expires: '',
    });
  } catch (error) {
    return errorResponse('获取文件下载地址失败: ' + error.message, 500);
  }
}
