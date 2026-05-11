import { invalidateStorageHealth } from '../../../../../utils/storage-health.js';

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

function parseFolderPath(raw) {
  if (!raw || raw === '/') return '';
  if (!raw.startsWith('cloudreve://')) {
    const normalized = raw.replace(/\/+$/, '');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash <= 0 ? '' : normalized.substring(0, lastSlash);
  }
  const rest = raw.slice('cloudreve://'.length);
  const idx = rest.indexOf('/');
  if (idx === -1) return '';
  const pathPart = rest.slice(idx).replace(/\/+$/, '');
  const lastSlash = pathPart.lastIndexOf('/');
  return lastSlash <= 0 ? '' : pathPart.substring(0, lastSlash);
}

function getListType(ext) {
  const imgExts = ['jpg','jpeg','png','gif','webp','bmp','svg','ico','tiff','tif','avif','heic','heif'];
  const vidExts = ['mp4','webm','mkv','avi','mov','wmv','flv','m4v','3gp','ogv'];
  const audExts = ['mp3','wav','ogg','flac','aac','wma','m4a','opus','ac3','mid','midi'];
  const docExts = ['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md','csv','json','xml','yaml','yml','html','htm','css','js','ts','py','java','c','cpp','h','hpp','sh','bat','ps1','epub','mobi','azw3','fb2'];

  if (imgExts.includes(ext)) return 'Image';
  if (vidExts.includes(ext)) return 'Video';
  if (audExts.includes(ext)) return 'Audio';
  if (docExts.includes(ext)) return 'Document';
  return 'None';
}

export async function onRequestPost(context) {
  const { env, request, params } = context;
  const sessionID = params.sessionID;

  if (!sessionID) {
    return errorResponse('缺少 sessionID', 400);
  }

  if (!env.img_url) {
    return errorResponse('KV (img_url) 未绑定（用于会话管理）', 500);
  }

  if (!env.DB) {
    return errorResponse('D1 (DB) 未绑定', 500);
  }

  try {
    const sessionRaw = await env.img_url.get('tmp:sess:' + sessionID);
    if (!sessionRaw) {
      return errorResponse('上传会话不存在或已过期', 404);
    }

    const session = JSON.parse(sessionRaw);
    const fileData = await request.arrayBuffer();

    if (!fileData || fileData.byteLength === 0) {
      return errorResponse('未接收到文件数据', 400);
    }

    const now = Date.now();
    const fileId = crypto.randomUUID();
    const folderPath = parseFolderPath(session.uri);

    const mime = session.mime_type || '';
    const ext = session.file_name.includes('.') ? session.file_name.split('.').pop().toLowerCase() : '';
    const listType = getListType(ext);

    const useTelegram = (session.channel === 'telegram' || (!session.channel && env.TG_Bot_Token && env.TG_Chat_ID));

    let storageType = 'd1';
    let storageKey = '';
    let tgFileId = '';

    if (useTelegram) {
      const { buildTelegramBotApiUrl, getTelegramUploadMethodAndField, pickTelegramFileId } = await import('../../../../utils/telegram.js');

      const formData = new FormData();
      formData.append('chat_id', env.TG_Chat_ID);
      const { method: apiEndpoint, field } = getTelegramUploadMethodAndField(mime || 'application/octet-stream');
      const blob = new Blob([fileData], { type: mime || 'application/octet-stream' });
      formData.append(field, blob, session.file_name);

      const tgResp = await fetch(buildTelegramBotApiUrl(env, apiEndpoint), {
        method: 'POST',
        body: formData,
      });

      if (!tgResp.ok) {
        const errBody = await tgResp.json().catch(() => ({}));
        await invalidateStorageHealth(env, 'telegram');
        return errorResponse('Telegram 上传失败: ' + (errBody.description || tgResp.statusText), 500);
      }

      const tgData = await tgResp.json();
      tgFileId = pickTelegramFileId(tgData);

      if (!tgFileId) {
        await invalidateStorageHealth(env, 'telegram');
        return errorResponse('Telegram 上传后未获取到 file_id', 500);
      }

      storageType = 'telegram';
      storageKey = tgFileId;
    }

    const maxRetries = 3;
    let lastError = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (useTelegram) {
          await env.DB.prepare(
            "INSERT OR IGNORE INTO files (id, storage_config_id, storage_type, storage_key, storage_file_id, file_name, physical_file_name, file_size, mime_type, folder_id, folder_path, list_type, label, liked, extra_json, created_at, updated_at) VALUES (?, 'default', 'telegram', ?, '', ?, '', ?, ?, '', ?, ?, ?, 0, '{}', ?, ?)"
          ).bind(
            fileId,
            storageKey,
            session.file_name,
            fileData.byteLength,
            mime,
            folderPath,
            listType,
            'None',
            now,
            now,
          ).run();
        } else {
          await env.DB.prepare(
            "INSERT OR IGNORE INTO files (id, storage_config_id, storage_type, storage_key, storage_file_id, file_name, physical_file_name, file_size, mime_type, folder_id, folder_path, list_type, label, liked, extra_json, created_at, updated_at, data) VALUES (?, 'default', 'd1', '', '', ?, '', ?, ?, '', ?, ?, ?, 0, '{}', ?, ?, ?)"
          ).bind(
            fileId,
            session.file_name,
            fileData.byteLength,
            mime,
            folderPath,
            listType,
            'None',
            now,
            now,
            fileData,
          ).run();
        }
        lastError = null;
        break;
      } catch (dbErr) {
        lastError = dbErr;
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }

    if (lastError) {
      return errorResponse('写入数据库失败: ' + lastError.message, 500);
    }

    await env.img_url.delete('tmp:sess:' + sessionID);

    if (env.img_url && fileData.byteLength > 0) {
      try {
        const cached = await env.img_url.get('capacity:used');
        if (cached !== null) {
          await env.img_url.put('capacity:used', String(parseInt(cached, 10) + fileData.byteLength));
        }
      } catch (e) {
        // ignore
      }
    }

    return cloudreveSuccess({
      uploaded: true,
      etag: fileId,
      file_id: fileId,
      name: session.file_name,
      size: fileData.byteLength,
      storage_type: storageType,
    });
  } catch (error) {
    return errorResponse('上传处理失败: ' + error.message, 500);
  }
}
