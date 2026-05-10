import { onRequestGet as listFilesInternal } from '../manage/list.js';
import { apiError, apiSuccess } from '../../utils/api-v1.js';

function normalizeStorageType(name = '', metadata = {}) {
  const explicit = metadata.storageType || metadata.storage;
  if (explicit) return String(explicit).toLowerCase();
  const keyName = String(name || '');
  if (keyName.startsWith('r2:')) return 'r2';
  if (keyName.startsWith('s3:')) return 's3';
  if (keyName.startsWith('discord:')) return 'discord';
  if (keyName.startsWith('hf:')) return 'huggingface';
  if (keyName.startsWith('webdav:')) return 'webdav';
  if (keyName.startsWith('github:')) return 'github';
  return 'telegram';
}

function normalizeMimeType(name = '') {
  const extension = String(name || '').split('.').pop()?.toLowerCase() || '';
  const map = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    pdf: 'application/pdf',
    txt: 'text/plain',
    json: 'application/json',
    zip: 'application/zip',
  };
  return map[extension] || 'application/octet-stream';
}

function mapFileItem(item) {
  const metadata = item?.metadata || {};
  const uploadTimestamp = Number(metadata.TimeStamp || 0);
  return {
    id: item?.name || '',
    name: metadata.fileName || item?.name || '',
    size: Number(metadata.fileSize || 0),
    type: normalizeMimeType(metadata.fileName || item?.name || ''),
    storage: normalizeStorageType(item?.name || '', metadata),
    uploadedAt: uploadTimestamp > 0 ? new Date(uploadTimestamp).toISOString() : null,
    folderPath: metadata.folderPath || '',
  };
}

export async function onRequestGet(context) {
  const response = await listFilesInternal(context);

  if (!response.ok) {
    let message = 'Failed to list files.';
    try {
      const payload = await response.clone().json();
      message = payload?.error || payload?.message || message;
    } catch {
      // keep fallback
    }
    return apiError('FILES_LIST_FAILED', message, response.status || 500);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return apiError('FILES_LIST_FAILED', 'Invalid list response.', 502);
  }

  const totalFromStats = Number(payload?.stats?.total);
  const fallbackTotal = Number(payload?.pageCount || payload?.keys?.length || 0);

  return apiSuccess({
    files: (payload?.keys || []).map(mapFileItem),
    pagination: {
      cursor: payload?.cursor || null,
      listComplete: Boolean(payload?.list_complete),
      pageCount: Number(payload?.pageCount || 0),
      total: Number.isFinite(totalFromStats) && totalFromStats >= 0 ? totalFromStats : fallbackTotal,
    },
  });
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return apiError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
  }
  return onRequestGet(context);
}
