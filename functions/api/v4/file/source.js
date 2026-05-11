import { generateDownloadToken } from '../../../utils/auth.js';

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

export async function onRequestPut(context) {
  const { env, request } = context;

  if (!env.DB) {
    return errorResponse('D1 (DB) 未绑定', 500);
  }

  if (!env.JWT_SECRET) {
    return errorResponse('JWT_SECRET 未配置，无法签发下载签名', 500);
  }

  try {
    const body = await request.json();
    const uris = body.uris || [];

    if (uris.length === 0) {
      return cloudreveSuccess([]);
    }

    const urlObj = new URL(request.url);
    const baseUrl = urlObj.origin;

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

    const results = [];
    for (const uri of uris) {
      const { fileName, folderPath } = parseUri(uri);

      let row = null;
      if (fileName) {
        row = await env.DB.prepare(
          "SELECT id, file_name, file_size, mime_type, storage_key FROM files WHERE folder_path = ? AND file_name = ? LIMIT 1"
        ).bind(folderPath, fileName).first();
      }

      if (row) {
        const dlToken = await generateDownloadToken(row.id, row.file_size || 0, env.JWT_SECRET);
        const fileUrl = baseUrl + '/api/v4/file/get/' + row.id + `?dl_token=${dlToken.token}&expires=${dlToken.expires}`;
        results.push({
          id: row.id,
          file_url: fileUrl,
          link: fileUrl,
          name: row.file_name,
        });
      } else {
        results.push({
          file_url: uri,
          link: uri,
          name: fileName || uri,
        });
      }
    }

    return cloudreveSuccess(results);
  } catch (error) {
    return errorResponse('获取文件源失败: ' + error.message, 500);
  }
}
