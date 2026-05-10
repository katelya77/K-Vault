import { createS3Client } from '../utils/s3client.js';
import { getDiscordFileUrl } from '../utils/discord.js';
import { getHuggingFaceFile } from '../utils/huggingface.js';
import { getWebDAVFile } from '../utils/webdav.js';
import { getGitHubFile } from '../utils/github.js';
import {
  buildTelegramBotApiUrl,
  buildTelegramFileUrl,
  parseSignedTelegramFileId,
  shouldWriteTelegramMetadata,
} from '../utils/telegram.js';
import { FileRepository } from '../../server/lib/db/repository.js';
import { generateContentDisposition, getMimeType } from '../utils/obfuscate.js';
import { debugLog, debugError, debugInfo } from '../utils/debug.js';

const STORAGE_PREFIXES = ['img:', 'vid:', 'aud:', 'doc:', 'r2:', 's3:', 'discord:', 'hf:', 'webdav:', 'github:', ''];

const MIME_TYPES = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogg: 'video/ogg',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  m4v: 'video/x-m4v',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  '3gp': 'video/3gpp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  wma: 'audio/x-ms-wma',
  opus: 'audio/opus',
  oga: 'audio/ogg',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  json: 'application/json',
  xml: 'application/xml',
  md: 'text/markdown',
  zip: 'application/zip',
  rar: 'application/x-rar-compressed',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
};

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'OPTIONS') {
    return handleOptions();
  }

  try {
    let fileId = params.id;
    if (!fileId) {
      return errorResponse('Missing file id', 400);
    }

    const signedTelegramMeta = await parseSignedTelegramFileId(fileId, env);
    if (signedTelegramMeta) {
      return handleSignedTelegramFile(context, signedTelegramMeta);
    }

    const recordResult = await getRecordWithKey(env, fileId);
    
    if (recordResult?.error) {
      return new Response(JSON.stringify({
        error: recordResult.error,
        errorCode: recordResult.errorCode
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const record = recordResult?.record;
    const kvKey = recordResult?.kvKey || fileId;

    if (env.img_url && !record?.metadata) {
      return errorResponse('File not found', 404);
    }

    let shareAccess = null;
    if (record?.metadata) {
      shareAccess = await verifyShareAccess(context, record.metadata, kvKey);
      if (shareAccess?.response) {
        return shareAccess.response;
      }
    }

    const storageType = inferStorageType(fileId, record?.metadata || {});
    let response;
    if (storageType === 'r2') {
      response = await handleR2File(context, record?.metadata?.r2Key || fileId, record);
    } else if (storageType === 's3') {
      response = await handleS3File(context, fileId, record);
    } else if (storageType === 'discord') {
      response = await handleDiscordFile(context, fileId, record);
    } else if (storageType === 'huggingface') {
      response = await handleHFFile(context, fileId, record);
    } else if (storageType === 'webdav') {
      response = await handleWebDAVFile(context, fileId, record);
    } else if (storageType === 'github') {
      response = await handleGitHubFile(context, fileId, record);
    } else {
      response = await handleTelegramFile(context, fileId, record);
    }

    if (shareAccess?.trackDownload && shouldCountAsDownload(request.method, response)) {
      const updatePromise = incrementShareDownloadCount(env, shareAccess.kvKey, shareAccess.metadata);
      if (typeof context.waitUntil === 'function') {
        context.waitUntil(updatePromise.catch(() => {}));
      } else {
        updatePromise.catch(() => {});
      }
    }

    return response;
  } catch (error) {
    console.error('file route error:', error);
    return errorResponse(`File proxy error: ${error?.message || 'Unknown error'}`, 502);
  }
}

function inferStorageType(name, metadata = {}) {
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

function addCorsHeaders(headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, Origin');
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition');
  headers.set('CDN-Cache-Control', 'no-store');
  return headers;
}

function addResponseHeaders(headers, fileName, mimeType, upstream = null) {
  addCorsHeaders(headers);
  headers.set('Content-Type', mimeType || 'application/octet-stream');
  headers.set('Cache-Control', 'no-store, max-age=0');
  headers.set('Accept-Ranges', 'bytes');

  if (fileName) {
    const encoded = encodeURIComponent(fileName);
    headers.set('Content-Disposition', `inline; filename="${encoded}"; filename*=UTF-8''${encoded}`);
  }

  if (upstream) {
    const contentLength = upstream.headers.get('Content-Length');
    const contentRange = upstream.headers.get('Content-Range');
    if (contentLength) headers.set('Content-Length', contentLength);
    if (contentRange) headers.set('Content-Range', contentRange);
  }
}

function handleOptions() {
  const headers = new Headers();
  addCorsHeaders(headers);
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(null, { status: 204, headers });
}

function errorResponse(message, status = 500) {
  const headers = new Headers();
  addCorsHeaders(headers);
  headers.set('Cache-Control', 'no-store, max-age=0');
  return new Response(message, { status, headers });
}

function shouldBlock(metadata = {}) {
  const listType = String(metadata.ListType || '').toLowerCase();
  const label = String(metadata.Label || '').toLowerCase();
  return listType === 'block' || label === 'adult';
}

function shouldWhitelistDeny(env, metadata = {}) {
  if (env.WhiteList_Mode !== 'true') return false;
  const listType = String(metadata.ListType || '').toLowerCase();
  return listType !== 'white';
}

function blockRedirect(requestUrl, request) {
  const referer = request.headers.get('Referer');
  if (referer) {
    return Response.redirect('https://static-res.pages.dev/teleimage/img-block-compressed.png', 302);
  }
  return Response.redirect(`${requestUrl.origin}/block-img.html`, 302);
}

async function getRecordWithKey(env, fileId) {
  debugLog(env, 'DOWNLOAD', 'Getting file record', { fileId });
  
  if (env.DB) {
    try {
      const fileRepo = new FileRepository(env.DB, env);
      
      const file = await fileRepo.findByFileId(fileId);
      
      if (file) {
        debugLog(env, 'DOWNLOAD', 'File found in database', { fileId, fileName: file.file_name });
        return {
          record: {
            metadata: {
              fileName: file.file_name,
              physicalFileName: file.physical_file_name,
              fileSize: file.file_size,
              mimeType: file.mime_type,
              storageType: file.storage_type,
              storageKey: file.storage_key,
              storageFileId: file.storage_file_id,
              TimeStamp: file.created_at,
              ListType: file.list_type,
              Label: file.label,
              liked: file.liked,
              ...JSON.parse(file.extra_json || '{}')
            }
          },
          kvKey: file.storage_key,
          dbFile: file
        };
      } else {
        debugLog(env, 'DOWNLOAD', 'File not found in database', { fileId });
      }
    } catch (error) {
      debugError(env, 'DOWNLOAD', 'Database query error', error);
      console.error('Database query error:', error);
      return {
        error: 'Database query failed',
        errorCode: 'DB_QUERY_ERROR'
      };
    }
  }

  if (!env.img_url) {
    debugLog(env, 'DOWNLOAD', 'KV storage not available', { fileId });
    return { record: null, kvKey: fileId };
  }

  debugLog(env, 'DOWNLOAD', 'Trying KV storage', { fileId });

  const hasKnownPrefix = STORAGE_PREFIXES.some((prefix) => prefix && fileId.startsWith(prefix));
  const candidateKeys = hasKnownPrefix ? [fileId] : STORAGE_PREFIXES.map((prefix) => `${prefix}${fileId}`);

  for (const key of candidateKeys) {
    const record = await env.img_url.getWithMetadata(key);
    if (record?.metadata) {
      debugLog(env, 'DOWNLOAD', 'File found in KV', { fileId, key });
      return { record, kvKey: key };
    }
  }

  debugLog(env, 'DOWNLOAD', 'File not found', { fileId });
  return { record: null, kvKey: fileId };
}

function getSharePassword(request) {
  const url = new URL(request.url);
  return String(
    url.searchParams.get('password')
    || request.headers.get('X-File-Password')
    || request.headers.get('X-Share-Password')
    || ''
  );
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(String(input || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function verifyShareAccess(context, metadata = {}, kvKey = '') {
  const expiresAt = Number(metadata.shareExpiresAt || 0);
  if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() > expiresAt) {
    return { response: errorResponse('File link has expired', 410) };
  }

  const maxDownloads = Number(metadata.shareMaxDownloads || 0);
  const currentDownloads = Number(metadata.shareDownloadCount || 0);
  if (Number.isFinite(maxDownloads) && maxDownloads > 0 && currentDownloads >= maxDownloads) {
    return { response: errorResponse('File download limit reached', 410) };
  }

  if (metadata.sharePasswordHash) {
    const providedPassword = getSharePassword(context.request);
    if (!providedPassword) {
      return { response: errorResponse('File password required', 401) };
    }
    const expected = await sha256Hex(`${String(metadata.sharePasswordSalt || '')}:${providedPassword}`);
    if (!timingSafeEqual(String(metadata.sharePasswordHash || ''), expected)) {
      return { response: errorResponse('File password invalid', 403) };
    }
  }

  return {
    response: null,
    trackDownload: Number.isFinite(maxDownloads) && maxDownloads > 0,
    kvKey,
    metadata,
  };
}

function shouldCountAsDownload(method, response) {
  if (String(method || '').toUpperCase() !== 'GET') return false;
  if (!response) return false;
  return response.status === 200 || response.status === 206;
}

async function incrementShareDownloadCount(env, kvKey, metadata = {}) {
  if (!env?.img_url || !kvKey || !metadata) return;
  const nextCount = Number(metadata.shareDownloadCount || 0) + 1;
  const nextMetadata = {
    ...metadata,
    shareDownloadCount: nextCount,
  };
  await env.img_url.put(kvKey, '', { metadata: nextMetadata });
}

async function handleTelegramFile(context, fileId, record = null) {
  const { request, env } = context;
  const url = new URL(request.url);

  const metadata = record?.metadata || {};
  if (shouldBlock(metadata)) {
    return blockRedirect(url, request);
  }
  if (shouldWhitelistDeny(env, metadata)) {
    return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
  }

  const fileName = metadata.fileName || fileId;
  const mimeType = metadata.mimeType || getMimeType(fileName);

  const telegramFileId = String(fileId).split('.')[0];
  const filePath = await getTelegramFilePath(env, telegramFileId);
  if (!filePath) {
    return errorResponse('Failed to get file path from Telegram', 500);
  }

  const rangeHeader = request.headers.get('Range');
  const fetchHeaders = new Headers();
  if (rangeHeader) fetchHeaders.set('Range', rangeHeader);

  const upstream = await fetch(buildTelegramFileUrl(env, filePath), {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: fetchHeaders,
    cf: { cacheTtl: 0, cacheEverything: false },
  });

  if (!upstream.ok && upstream.status !== 206) {
    return errorResponse('Failed to fetch file from Telegram', upstream.status);
  }

  const headers = new Headers();
  addResponseHeaders(headers, fileName, mimeType, upstream);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

async function handleSignedTelegramFile(context, signedMeta) {
  const { request, env } = context;

  const filePath = await getTelegramFilePath(env, signedMeta.fileId);
  if (!filePath) {
    return errorResponse('Failed to get file path from Telegram', 500);
  }

  await backfillSignedTelegramMetadata(env, signedMeta);

  const fileName = signedMeta.fileName || `${signedMeta.fileId}.${signedMeta.fileExtension || 'bin'}`;
  const mimeType = signedMeta.mimeType || getMimeType(fileName);

  const rangeHeader = request.headers.get('Range');
  const fetchHeaders = new Headers();
  if (rangeHeader) fetchHeaders.set('Range', rangeHeader);

  const upstream = await fetch(buildTelegramFileUrl(env, filePath), {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: fetchHeaders,
    cf: { cacheTtl: 0, cacheEverything: false },
  });

  if (!upstream.ok && upstream.status !== 206) {
    return errorResponse('Failed to fetch file from Telegram', upstream.status);
  }

  const headers = new Headers();
  addResponseHeaders(headers, fileName, mimeType, upstream);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

async function backfillSignedTelegramMetadata(env, signedMeta) {
  if (!env.img_url || !shouldWriteTelegramMetadata(env)) {
    return;
  }

  const fileExtension = signedMeta.fileExtension || 'bin';
  const kvKey = `${signedMeta.fileId}.${fileExtension}`;

  try {
    const existing = await env.img_url.getWithMetadata(kvKey);
    if (existing?.metadata) return;

    await env.img_url.put(kvKey, '', {
      metadata: {
        TimeStamp: signedMeta.timestamp || Date.now(),
        ListType: 'None',
        Label: 'None',
        liked: false,
        fileName: signedMeta.fileName || `${signedMeta.fileId}.${fileExtension}`,
        fileSize: signedMeta.fileSize || 0,
        storageType: 'telegram',
        telegramFileId: signedMeta.fileId,
        telegramMessageId: signedMeta.messageId || undefined,
        signedLink: true,
        source: 'signed-backfill',
      },
    });
  } catch (error) {
    console.warn('Signed metadata backfill skipped:', error.message);
  }
}

async function handleR2File(context, r2Key, record = null) {
  const { request, env } = context;
  const requestUrl = new URL(request.url);

  if (!env.R2_BUCKET) {
    return errorResponse('R2 storage not configured', 500);
  }

  if (!record?.metadata) {
    const resolved = await getR2RecordFromKV(env, r2Key);
    record = resolved;
  }

  if (!record?.metadata) {
    return errorResponse('File not found', 404);
  }

  if (shouldBlock(record.metadata)) {
    return blockRedirect(requestUrl, request);
  }
  if (shouldWhitelistDeny(env, record.metadata)) {
    return Response.redirect(`${requestUrl.origin}/whitelist-on.html`, 302);
  }

  const fileName = record.metadata.fileName || r2Key;
  const mimeType = getMimeType(fileName);

  const rangeHeader = request.headers.get('Range');
  let object;

  if (rangeHeader) {
    const range = parseSimpleRange(rangeHeader);
    if (range) {
      const head = await env.R2_BUCKET.head(r2Key);
      if (!head) return errorResponse('File not found in R2', 404);

      const start = range.start ?? 0;
      const end = range.end ?? (head.size - 1);
      if (start >= head.size) {
        const headers = new Headers();
        addCorsHeaders(headers);
        headers.set('Content-Range', `bytes */${head.size}`);
        return new Response('Range Not Satisfiable', { status: 416, headers });
      }

      object = await env.R2_BUCKET.get(r2Key, {
        range: { offset: start, length: Math.min(end, head.size - 1) - start + 1 },
      });
    }
  }

  if (!object) {
    object = await env.R2_BUCKET.get(r2Key);
  }

  if (!object) {
    return errorResponse('File not found in R2', 404);
  }

  const headers = new Headers();
  addResponseHeaders(headers, fileName, mimeType);
  headers.set('Content-Length', String(object.size));

  return new Response(object.body, {
    status: 200,
    headers,
  });
}

async function getR2RecordFromKV(env, r2Key) {
  if (!env.img_url) return null;

  const candidateKeys = r2Key.startsWith('r2:') ? [r2Key, r2Key.slice(3)] : [`r2:${r2Key}`, r2Key];

  for (const key of candidateKeys) {
    const record = await env.img_url.getWithMetadata(key);
    if (record?.metadata) return record;
  }

  return null;
}

function parseSimpleRange(rangeHeader) {
  const match = String(rangeHeader || '').match(/bytes=(\d*)-(\d*)/);
  if (!match) return null;

  const start = match[1] ? parseInt(match[1], 10) : null;
  const end = match[2] ? parseInt(match[2], 10) : null;

  if (start == null && end == null) return null;
  return { start, end };
}

async function handleS3File(context, fileId, record = null) {
  const { request, env } = context;
  const requestUrl = new URL(request.url);

  if (!record?.metadata) {
    record = await findRecordByPrefixes(env, fileId, ['s3:', 'img:', 'vid:', 'aud:', 'doc:', '']);
  }
  if (!record?.metadata) return errorResponse('File not found', 404);

  if (shouldBlock(record.metadata)) {
    return blockRedirect(requestUrl, request);
  }
  if (shouldWhitelistDeny(env, record.metadata)) {
    return Response.redirect(`${requestUrl.origin}/whitelist-on.html`, 302);
  }

  const s3Key = record.metadata.s3Key || fileId.replace(/^s3:/, '');
  const fileName = record.metadata.fileName || fileId;
  const mimeType = getMimeType(fileName);

  const s3 = createS3Client(env);
  const rangeHeader = request.headers.get('Range');
  const upstream = await s3.getObject(s3Key, rangeHeader ? { range: rangeHeader } : {});

  if (!upstream) return errorResponse('File not found in S3', 404);

  const headers = new Headers();
  addResponseHeaders(headers, fileName, mimeType, upstream);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

async function handleDiscordFile(context, fileId, record = null) {
  const { request, env } = context;
  const requestUrl = new URL(request.url);

  if (!record?.metadata) {
    record = await findRecordByPrefixes(env, fileId, ['discord:', 'img:', 'vid:', 'aud:', 'doc:', '']);
  }
  if (!record?.metadata) return errorResponse('File not found', 404);

  if (shouldBlock(record.metadata)) {
    return blockRedirect(requestUrl, request);
  }
  if (shouldWhitelistDeny(env, record.metadata)) {
    return Response.redirect(`${requestUrl.origin}/whitelist-on.html`, 302);
  }

  const { discordChannelId, discordMessageId } = record.metadata;
  if (!discordChannelId || !discordMessageId) {
    return errorResponse('Discord metadata incomplete', 500);
  }

  const fileInfo = await getDiscordFileUrl(discordChannelId, discordMessageId, env);
  if (!fileInfo) return errorResponse('File not found on Discord', 404);

  const rangeHeader = request.headers.get('Range');
  const upstream = await fetch(fileInfo.url, {
    headers: rangeHeader ? { Range: rangeHeader } : {},
  });

  if (!upstream.ok && upstream.status !== 206) {
    return errorResponse('Error fetching file from Discord', 502);
  }

  const fileName = record.metadata.fileName || fileInfo.filename || fileId;
  const mimeType = getMimeType(fileName);

  const headers = new Headers();
  addResponseHeaders(headers, fileName, mimeType, upstream);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

async function handleHFFile(context, fileId, record = null) {
  const { request, env } = context;
  const requestUrl = new URL(request.url);

  if (!record?.metadata) {
    record = await findRecordByPrefixes(env, fileId, ['hf:', 'img:', 'vid:', 'aud:', 'doc:', '']);
  }
  if (!record?.metadata) return errorResponse('File not found', 404);

  if (shouldBlock(record.metadata)) {
    return blockRedirect(requestUrl, request);
  }
  if (shouldWhitelistDeny(env, record.metadata)) {
    return Response.redirect(`${requestUrl.origin}/whitelist-on.html`, 302);
  }

  const hfPath = record.metadata.hfPath;
  if (!hfPath) return errorResponse('HuggingFace path missing', 500);

  const rangeHeader = request.headers.get('Range');
  const upstream = await getHuggingFaceFile(hfPath, env, rangeHeader ? { range: rangeHeader } : {});

  if (!upstream.ok && upstream.status !== 206) {
    return errorResponse('File not found on HuggingFace', upstream.status || 404);
  }

  const fileName = record.metadata.fileName || fileId;
  const mimeType = getMimeType(fileName);

  const headers = new Headers();
  addResponseHeaders(headers, fileName, mimeType, upstream);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

async function handleWebDAVFile(context, fileId, record = null) {
  const { request, env } = context;
  const requestUrl = new URL(request.url);

  if (!record?.metadata) {
    record = await findRecordByPrefixes(env, fileId, ['webdav:', 'img:', 'vid:', 'aud:', 'doc:', '']);
  }
  if (!record?.metadata) return errorResponse('File not found', 404);

  if (shouldBlock(record.metadata)) {
    return blockRedirect(requestUrl, request);
  }
  if (shouldWhitelistDeny(env, record.metadata)) {
    return Response.redirect(`${requestUrl.origin}/whitelist-on.html`, 302);
  }

  const webdavPath = record.metadata.webdavPath || fileId.replace(/^webdav:/, '');
  if (!webdavPath) return errorResponse('WebDAV path missing', 500);

  const rangeHeader = request.headers.get('Range');
  const upstream = await getWebDAVFile(webdavPath, env, rangeHeader ? { range: rangeHeader } : {});
  if (!upstream) return errorResponse('File not found on WebDAV', 404);

  const fileName = record.metadata.fileName || fileId;
  const mimeType = getMimeType(fileName);

  const headers = new Headers();
  addResponseHeaders(headers, fileName, mimeType, upstream);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

async function handleGitHubFile(context, fileId, record = null) {
  const { request, env } = context;
  const requestUrl = new URL(request.url);

  if (!record?.metadata) {
    record = await findRecordByPrefixes(env, fileId, ['github:', 'img:', 'vid:', 'aud:', 'doc:', '']);
  }
  if (!record?.metadata) return errorResponse('File not found', 404);

  if (shouldBlock(record.metadata)) {
    return blockRedirect(requestUrl, request);
  }
  if (shouldWhitelistDeny(env, record.metadata)) {
    return Response.redirect(`${requestUrl.origin}/whitelist-on.html`, 302);
  }

  const githubStorageKey = record.metadata.githubStorageKey || fileId.replace(/^github:/, '');
  const rangeHeader = request.headers.get('Range');
  const upstream = await getGitHubFile(
    githubStorageKey,
    record.metadata || {},
    env,
    rangeHeader ? { range: rangeHeader } : {}
  );

  if (!upstream) return errorResponse('File not found on GitHub', 404);

  const fileName = record.metadata.fileName || fileId;
  const mimeType = getMimeType(fileName);

  const headers = new Headers();
  addResponseHeaders(headers, fileName, mimeType, upstream);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

async function findRecordByPrefixes(env, fileId, prefixes = []) {
  if (!env.img_url) return null;

  for (const prefix of prefixes) {
    const key = `${prefix}${fileId}`;
    const record = await env.img_url.getWithMetadata(key);
    if (record?.metadata) return record;
  }
  return null;
}

async function getTelegramFilePath(env, fileId) {
  try {
    const url = `${buildTelegramBotApiUrl(env, 'getFile')}?file_id=${encodeURIComponent(fileId)}`;
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) return null;

    const data = await response.json();
    if (!data?.ok || !data?.result?.file_path) return null;
    return data.result.file_path;
  } catch (error) {
    console.error('getTelegramFilePath failed:', error);
    return null;
  }
}
