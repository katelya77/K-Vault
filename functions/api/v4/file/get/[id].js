import { verifyDownloadToken } from '../../../../utils/auth.js';
import { buildTelegramBotApiUrl, buildTelegramFileUrl } from '../../../../utils/telegram.js';

function errorResponse(msg, status = 404) {
  return new Response(JSON.stringify({ code: status, msg, error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const MIME_TYPES = {
  'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
  'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp',
  'svg': 'image/svg+xml', 'ico': 'image/x-icon',
  'mp4': 'video/mp4', 'webm': 'video/webm', 'mkv': 'video/x-matroska',
  'avi': 'video/x-msvideo', 'mov': 'video/quicktime',
  'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
  'flac': 'audio/flac', 'aac': 'audio/aac',
  'pdf': 'application/pdf', 'txt': 'text/plain', 'md': 'text/markdown',
  'html': 'text/html', 'htm': 'text/html', 'css': 'text/css',
  'js': 'application/javascript', 'json': 'application/json',
  'xml': 'application/xml', 'csv': 'text/csv',
  'zip': 'application/zip', 'rar': 'application/vnd.rar',
  '7z': 'application/x-7z-compressed', 'tar': 'application/x-tar',
  'gz': 'application/gzip',
};

export async function onRequestGet(context) {
  const { env, params } = context;
  const fileId = params.id;

  if (!fileId) {
    return errorResponse('缺少文件 ID', 400);
  }

  if (!env.DB) {
    return errorResponse('D1 (DB) 未绑定', 500);
  }

  if (!env.JWT_SECRET) {
    return errorResponse('JWT_SECRET 未配置，无法签发下载签名', 500);
  }

  const url = new URL(context.request.url);
  const dlToken = url.searchParams.get('dl_token');
  const expires = url.searchParams.get('expires');

  if (!dlToken || !expires) {
    return new Response(JSON.stringify({ code: 401, msg: '缺少下载签名', error: 'Missing download token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const authorized = await verifyDownloadToken(fileId, dlToken, expires, env.JWT_SECRET);
  if (!authorized) {
    return new Response(JSON.stringify({ code: 401, msg: '下载签名无效或已过期', error: 'Invalid or expired download token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  try {
    const row = await env.DB.prepare(
      'SELECT id, file_name, physical_file_name, mime_type, file_size, storage_key, storage_type, storage_file_id, data FROM files WHERE id = ? LIMIT 1'
    ).bind(fileId).first();

    if (!row) {
      return errorResponse('文件不存在', 404);
    }

    const ext = row.file_name.includes('.') ? row.file_name.split('.').pop().toLowerCase() : '';
    const contentType = MIME_TYPES[ext] || row.mime_type || 'application/octet-stream';

    let fileData = null;

    if (row.data) {
      fileData = row.data;
    } else if (row.storage_type === 'kv' && row.storage_key && env.img_url) {
      fileData = await env.img_url.get(row.storage_key, { type: 'arrayBuffer' });
    }

    if (fileData) {
      if (ext === 'mp4' || ext === 'webm' || ext === 'mkv' || ext === 'mov' || ext === 'avi') {
        const rangeHeader = context.request.headers.get('Range');
        if (rangeHeader) {
          const parts = rangeHeader.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0]);
          const end = parts[1] ? parseInt(parts[1]) : Math.min(start + 1048576, fileData.byteLength - 1);
          const chunk = fileData.slice(start, end + 1);
          return new Response(chunk, {
            status: 206,
            headers: {
              'Content-Type': contentType,
              'Content-Range': `bytes ${start}-${end}/${fileData.byteLength}`,
              'Content-Length': String(chunk.byteLength),
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'public, max-age=31536000',
            },
          });
        }
      }

      return new Response(fileData, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(fileData.byteLength),
          'Cache-Control': 'public, max-age=31536000',
          'Accept-Ranges': 'bytes',
          'Content-Disposition': 'inline; filename="' + row.file_name + '"',
        },
      });
    }

    if (row.storage_type === 'telegram' && row.storage_key && env.TG_Bot_Token) {
      const tgApiUrl = buildTelegramBotApiUrl(env, 'getFile') + '?file_id=' + encodeURIComponent(row.storage_key);
      const tgResp = await fetch(tgApiUrl);
      const tgData = await tgResp.json();

      if (tgData.ok && tgData.result?.file_path) {
        const fileUrl = buildTelegramFileUrl(env, tgData.result.file_path);
        const upstream = await fetch(fileUrl);
        if (!upstream.ok) {
          return errorResponse('从 Telegram 获取文件失败', upstream.status);
        }

        const displayName = row.file_name;
        const headers = new Headers();
        headers.set('Content-Type', contentType);
        headers.set('Content-Length', upstream.headers.get('Content-Length') || '');
        headers.set('Cache-Control', 'public, max-age=31536000');
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Content-Disposition', 'inline; filename="' + displayName + '"');
        headers.set('Access-Control-Allow-Origin', '*');

        return new Response(upstream.body, {
          status: 200,
          headers,
        });
      }
    }

    return errorResponse('文件数据不存在或已过期', 404);
  } catch (error) {
    return errorResponse('获取文件失败: ' + error.message, 500);
  }
}
