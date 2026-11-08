import { createS3Client } from '../../utils/s3client.js';
import { uploadToDiscord } from '../../utils/discord.js';
import { hasHuggingFaceConfig, uploadToHuggingFace } from '../../utils/huggingface.js';
import { hasWebDAVConfig, normalizeWebDAVPath, uploadToWebDAV } from '../../utils/webdav.js';
import { hasGitHubConfig, normalizeGitHubStoragePath, uploadToGitHub } from '../../utils/github.js';
import {
  buildTelegramBotApiUrl,
  buildTelegramDirectLink,
  createSignedTelegramFileId,
  getTelegramUploadMethodAndField,
  pickTelegramFileId,
  sendTelegramUploadNotice,
  shouldUseSignedTelegramLinks,
  shouldWriteTelegramMetadata,
} from '../../utils/telegram.js';
import { apiError, apiSuccess, readIdempotentResponse, saveIdempotentResponse } from '../../utils/api-v1.js';
import { checkUploadPolicy } from '../../utils/policy-enforce.js';
import { normalizeFolderPath } from '../../utils/folder-path.js';
import { MAX_REDIRECTS, sniffImageMime, validateRedirectLocation, validateRemoteUrl } from '../../utils/ssrf-guard.js';

/**
 * POST /api/v1/import (requirement #6).
 * Agent-facing remote image import: server-side download with strict SSRF
 * protections, MIME sniffing, streaming size cap, SHA-256, content
 * deduplication and storage routing. Requires "upload" scope (middleware).
 */

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30000;
const MB = 1024 * 1024;
const DEDUP_TTL_SECONDS = 90 * 24 * 3600;

const STORAGE_LIMITS = {
  discord: { maxBytes: 25 * MB, message: 'Discord uploads are capped at 25MB.' },
  huggingface: { maxBytes: 35 * MB, message: 'HuggingFace uploads are capped at 35MB.' },
  telegram: { maxBytes: 50 * MB, message: 'Telegram uploads are capped at 50MB.' },
};

class ImportError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function joinStoragePath(folderPath, fileName) {
  const base = normalizeFolderPath(folderPath);
  return base ? `${base}/${fileName}` : fileName;
}

function getExtensionFromMime(mime) {
  const map = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp',
    'image/x-icon': 'ico',
  };
  return map[mime] || 'bin';
}

function randomId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

async function sha256HexBuffer(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Strict remote fetch with SSRF checks on every redirect hop. */
async function fetchRemoteStrict(rawUrl, maxBytes) {
  let currentUrl;
  try {
    currentUrl = new URL(String(rawUrl || '').trim());
  } catch {
    throw new ImportError('INVALID_URL', 'Invalid URL.', 400);
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const check = validateRemoteUrl(currentUrl.href);
    if (!check.ok) throw new ImportError(check.code, check.message, 400);

    let response;
    try {
      response = await fetch(currentUrl.href, {
        redirect: 'manual',
        headers: { 'User-Agent': 'K-Vault-Import/1.0' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ImportError('IMPORT_UPSTREAM_ERROR', `Remote fetch failed: ${error?.message || 'network error'}`, 502);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('Location');
      if (!location) throw new ImportError('IMPORT_UPSTREAM_ERROR', 'Redirect response without Location header.', 502);
      const redirectCheck = validateRedirectLocation(location, currentUrl);
      if (!redirectCheck.ok) throw new ImportError(redirectCheck.code, redirectCheck.message, 400);
      currentUrl = redirectCheck.url;
      continue;
    }

    if (!response.ok) {
      throw new ImportError('IMPORT_UPSTREAM_ERROR', `Upstream returned HTTP ${response.status}.`, 502);
    }

    // Content-Length is a pre-check only; the stream cap below is authoritative.
    const contentLength = Number(response.headers.get('Content-Length') || 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new ImportError('IMPORT_TOO_LARGE', `Remote file exceeds the ${maxBytes} byte limit.`, 413);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new ImportError('IMPORT_EMPTY', 'Remote response has no body.', 400);

    const chunks = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) {
          throw new ImportError('IMPORT_TOO_LARGE', `Remote file exceeds the ${maxBytes} byte limit.`, 413);
        }
        chunks.push(value);
      }
    } catch (error) {
      try { await reader.cancel(); } catch { /* noop */ }
      if (error instanceof ImportError) throw error;
      throw new ImportError('IMPORT_UPSTREAM_ERROR', `Download interrupted: ${error?.message || 'stream error'}`, 502);
    }

    const buffer = concatChunks(chunks, received);
    if (buffer.byteLength === 0) {
      throw new ImportError('IMPORT_EMPTY', 'Remote file is empty.', 400);
    }

    return { buffer, contentType: response.headers.get('Content-Type') || '', finalUrl: currentUrl };
  }

  throw new ImportError('SSRF_BLOCKED', `Too many redirects (max ${MAX_REDIRECTS}).`, 400);
}

function concatChunks(chunks, totalLength) {
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output.buffer;
}

/** Decide the final MIME: sniffed magic bytes win; SVG is rejected by default. */
function resolveImportMime(buffer, contentTypeHeader, fileName) {
  const sniffed = sniffImageMime(new Uint8Array(buffer.slice(0, 32)));
  const header = String(contentTypeHeader || '').split(';')[0].trim().toLowerCase();
  const name = String(fileName || '').toLowerCase();

  if (header === 'image/svg+xml' || name.endsWith('.svg')) {
    throw new ImportError('IMPORT_MIME_BLOCKED', 'SVG imports are disabled by default (XSS risk).', 415);
  }
  if (!sniffed) {
    // Text-based rejection: XML/SVG payloads sniff as null.
    const head = new TextDecoder().decode(new Uint8Array(buffer.slice(0, 256))).trim().toLowerCase();
    if (head.startsWith('<?xml') || head.startsWith('<svg') || head.includes('<svg')) {
      throw new ImportError('IMPORT_MIME_BLOCKED', 'SVG imports are disabled by default (XSS risk).', 415);
    }
    if (header && header.startsWith('image/') && header !== 'image/svg+xml') {
      throw new ImportError('IMPORT_MIME_BLOCKED', `Content-Type "${header}" does not match file content.`, 415);
    }
    throw new ImportError('IMPORT_MIME_BLOCKED', 'Unsupported file type. Only images (jpeg/png/webp/avif/gif/bmp/ico) can be imported.', 415);
  }
  if (header && header.startsWith('image/') && header !== 'image/svg+xml' && header !== sniffed) {
    // header/sniff mismatch: keep the sniffed value (authoritative).
  }
  return sniffed;
}

function checkStorageLimit(storage, sizeBytes) {
  const limit = STORAGE_LIMITS[storage];
  if (limit && sizeBytes > limit.maxBytes) {
    throw new ImportError('IMPORT_TOO_LARGE', limit.message, 413);
  }
}

/* ---------- storage dispatch (KV metadata layout matches upload-from-url) ---------- */

function appendCommonMetadata(metadata, folderPath) {
  return folderPath ? { ...metadata, folderPath } : metadata;
}

async function uploadToTelegramStorage(env, { bytes, mime, fileName, extension, fileSize, folderPath }) {
  const file = new File([new Blob([bytes], { type: mime })], fileName, { type: mime });
  const { method: apiEndpoint, field } = getTelegramUploadMethodAndField(mime);

  const formData = new FormData();
  formData.append('chat_id', env.TG_Chat_ID || env.TG_CHAT_ID);
  formData.append(field, file);

  let response = await fetch(buildTelegramBotApiUrl(env, apiEndpoint), { method: 'POST', body: formData });
  let data = await response.json().catch(() => ({}));

  if (!response.ok && apiEndpoint === 'sendAudio') {
    const docFormData = new FormData();
    docFormData.append('chat_id', env.TG_Chat_ID || env.TG_CHAT_ID);
    docFormData.append('document', file);
    response = await fetch(buildTelegramBotApiUrl(env, 'sendDocument'), { method: 'POST', body: docFormData });
    data = await response.json().catch(() => ({}));
  }

  if (!response.ok) {
    throw new ImportError('UPLOAD_FAILED', `Telegram upload failed: ${data?.description || 'unknown error'}`, 502);
  }

  const telegramFileId = pickTelegramFileId(data);
  if (!telegramFileId) {
    throw new ImportError('UPLOAD_FAILED', 'Telegram accepted the file but returned no usable file id.', 502);
  }

  const messageId = data?.result?.message_id;
  const directId = shouldUseSignedTelegramLinks(env)
    ? await createSignedTelegramFileId({ fileId: telegramFileId, fileExtension: extension, fileName, mimeType: mime, fileSize, messageId }, env)
    : `${telegramFileId}.${extension}`;

  if (env.img_url && shouldWriteTelegramMetadata(env)) {
    await env.img_url.put(`${telegramFileId}.${extension}`, '', {
      metadata: appendCommonMetadata({
        TimeStamp: Date.now(),
        ListType: 'None',
        Label: 'None',
        liked: false,
        fileName,
        fileSize,
        storageType: 'telegram',
        telegramFileId,
        telegramMessageId: messageId || undefined,
        signedLink: shouldUseSignedTelegramLinks(env),
      }, folderPath),
    });
  }

  try {
    await sendTelegramUploadNotice({
      chatId: env.TG_Chat_ID || env.TG_CHAT_ID,
      replyToMessageId: messageId || undefined,
      directLink: buildTelegramDirectLink(env, directId, ''),
      fileId: telegramFileId,
      messageId,
      fileName,
      fileSize,
    }, env);
  } catch { /* notice failures are non-fatal */ }

  return { fileId: `${telegramFileId}.${extension}`, directId };
}

async function uploadToR2Storage(env, { bytes, mime, fileName, extension, fileSize, folderPath }) {
  if (!env.R2_BUCKET) throw new ImportError('STORAGE_NOT_CONFIGURED', 'R2 is not configured.', 400);
  const fileId = randomId('r2');
  const objectKey = `${fileId}.${extension}`;
  await env.R2_BUCKET.put(objectKey, bytes, {
    httpMetadata: { contentType: mime },
    customMetadata: { fileName, uploadTime: Date.now().toString() },
  });
  if (env.img_url) {
    await env.img_url.put(`r2:${objectKey}`, '', {
      metadata: appendCommonMetadata({
        TimeStamp: Date.now(), ListType: 'None', Label: 'None', liked: false,
        fileName, fileSize, storageType: 'r2', r2Key: objectKey,
      }, folderPath),
    });
  }
  return { fileId: objectKey, directId: `r2:${objectKey}` };
}

async function uploadToS3Storage(env, { bytes, mime, fileName, extension, fileSize, folderPath }) {
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID) throw new ImportError('STORAGE_NOT_CONFIGURED', 'S3 is not configured.', 400);
  const s3 = createS3Client(env);
  const fileId = randomId('s3');
  const objectKey = `${fileId}.${extension}`;
  await s3.putObject(objectKey, bytes, {
    contentType: mime,
    metadata: { 'x-amz-meta-filename': fileName, 'x-amz-meta-uploadtime': Date.now().toString() },
  });
  if (env.img_url) {
    await env.img_url.put(`s3:${objectKey}`, '', {
      metadata: appendCommonMetadata({
        TimeStamp: Date.now(), ListType: 'None', Label: 'None', liked: false,
        fileName, fileSize, storageType: 's3', s3Key: objectKey,
      }, folderPath),
    });
  }
  return { fileId: objectKey, directId: `s3:${objectKey}` };
}

async function uploadToDiscordStorage(env, { bytes, mime, fileName, extension, fileSize, folderPath }) {
  if (!env.DISCORD_WEBHOOK_URL && !env.DISCORD_BOT_TOKEN) throw new ImportError('STORAGE_NOT_CONFIGURED', 'Discord is not configured.', 400);
  const result = await uploadToDiscord(bytes, mime, env);
  if (!result.success) throw new ImportError('UPLOAD_FAILED', `Discord upload failed: ${result.error}`, 502);
  const fileId = randomId('discord');
  const kvKey = `discord:${fileId}.${extension}`;
  if (env.img_url) {
    await env.img_url.put(kvKey, '', {
      metadata: appendCommonMetadata({
        TimeStamp: Date.now(), ListType: 'None', Label: 'None', liked: false,
        fileName, fileSize, storageType: 'discord',
        discordChannelId: result.channelId, discordMessageId: result.messageId,
        discordAttachmentId: result.attachmentId, discordUploadMode: result.mode,
        discordSourceUrl: result.sourceUrl,
      }, folderPath),
    });
  }
  return { fileId: `${fileId}.${extension}`, directId: kvKey };
}

async function uploadToHuggingFaceStorage(env, { bytes, mime, fileName, extension, fileSize, folderPath }) {
  if (!hasHuggingFaceConfig(env)) throw new ImportError('STORAGE_NOT_CONFIGURED', 'HuggingFace is not configured.', 400);
  const fileId = randomId('hf');
  const hfPath = joinStoragePath(folderPath, `${fileId}.${extension}`);
  const result = await uploadToHuggingFace(bytes, hfPath, fileName, env);
  if (!result.success) throw new ImportError('UPLOAD_FAILED', `HuggingFace upload failed: ${result.error}`, 502);
  const kvKey = `hf:${fileId}.${extension}`;
  if (env.img_url) {
    await env.img_url.put(kvKey, '', {
      metadata: appendCommonMetadata({
        TimeStamp: Date.now(), ListType: 'None', Label: 'None', liked: false,
        fileName, fileSize, storageType: 'huggingface', hfPath,
      }, folderPath),
    });
  }
  return { fileId: `${fileId}.${extension}`, directId: kvKey };
}

async function uploadToWebDAVStorage(env, { bytes, mime, fileName, extension, fileSize, folderPath }) {
  if (!hasWebDAVConfig(env)) throw new ImportError('STORAGE_NOT_CONFIGURED', 'WebDAV is not configured.', 400);
  const fileId = randomId('wd');
  const publicId = `${fileId}.${extension}`;
  const webdavPath = joinStoragePath(folderPath, publicId);
  const result = await uploadToWebDAV(bytes, webdavPath, mime || 'application/octet-stream', env);
  const kvKey = `webdav:${publicId}`;
  if (env.img_url) {
    await env.img_url.put(kvKey, '', {
      metadata: appendCommonMetadata({
        TimeStamp: Date.now(), ListType: 'None', Label: 'None', liked: false,
        fileName, fileSize, storageType: 'webdav',
        webdavPath: normalizeWebDAVPath(result.path || webdavPath),
        webdavEtag: result.etag || undefined,
      }, folderPath),
    });
  }
  return { fileId: publicId, directId: kvKey };
}

async function uploadToGitHubStorage(env, { bytes, mime, fileName, extension, fileSize, folderPath }) {
  if (!hasGitHubConfig(env)) throw new ImportError('STORAGE_NOT_CONFIGURED', 'GitHub is not configured.', 400);
  const fileId = randomId('github');
  const publicId = `${fileId}.${extension}`;
  const githubStorageKey = joinStoragePath(folderPath, publicId);
  const result = await uploadToGitHub(bytes, normalizeGitHubStoragePath(githubStorageKey), fileName, mime || 'application/octet-stream', env);
  const kvKey = `github:${publicId}`;
  if (env.img_url) {
    await env.img_url.put(kvKey, '', {
      metadata: appendCommonMetadata({
        TimeStamp: Date.now(), ListType: 'None', Label: 'None', liked: false,
        fileName, fileSize, storageType: 'github',
        githubStorageKey: normalizeGitHubStoragePath(result.storagePath || githubStorageKey),
        ...(result.metadata || {}),
      }, folderPath),
    });
  }
  return { fileId: publicId, directId: kvKey };
}

const STORAGE_DISPATCHERS = {
  telegram: uploadToTelegramStorage,
  r2: uploadToR2Storage,
  s3: uploadToS3Storage,
  discord: uploadToDiscordStorage,
  huggingface: uploadToHuggingFaceStorage,
  webdav: uploadToWebDAVStorage,
  github: uploadToGitHubStorage,
};

/* ---------- route handler ---------- */

export async function onRequestPost(context) {
  const { request, env, data } = context;
  const token = data?.apiToken;

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const rawUrl = String(body?.url || '').trim();
  if (!rawUrl) {
    return apiError('VALIDATION_ERROR', 'Field "url" is required.', 400);
  }

  const storage = String(body?.storage || '').trim().toLowerCase() || 'telegram';
  if (!STORAGE_DISPATCHERS[storage]) {
    return apiError('VALIDATION_ERROR', `Unknown storage "${storage}". Valid: ${Object.keys(STORAGE_DISPATCHERS).join(', ')}.`, 400);
  }

  const folderPath = normalizeFolderPath(body?.folder || body?.folderPath || '');
  const deduplicate = body?.deduplicate === true;
  const customFileName = String(body?.fileName || '').trim().slice(0, 200);

  // Token size cap (policy) vs global cap.
  const maxBytes = Math.min(token?.policies?.maxFileSize || MAX_FILE_SIZE, MAX_FILE_SIZE);

  try {
    // Policy gate (requirement #10) — checked before any network activity.
    const policyCheck = checkUploadPolicy(token, {
      storage,
      folderPath,
      request,
    });
    if (!policyCheck.ok) {
      return apiError(policyCheck.code, policyCheck.message, policyCheck.status);
    }

    const idempotencyKey = String(request.headers.get('Idempotency-Key') || '').trim().slice(0, 200);
    const replayKey = token?.id && idempotencyKey && env.img_url
      ? `idem:import:${token.id}:${await sha256HexBuffer(new TextEncoder().encode(idempotencyKey))}`
      : '';
    const replay = await readIdempotentResponse(env, replayKey);
    if (replay) return replay;

    // Strict remote fetch (SSRF hardening, streaming size cap).
    const fetched = await fetchRemoteStrict(rawUrl, maxBytes);
    const sizeBytes = fetched.buffer.byteLength;

    // MIME sniff (magic bytes win; SVG rejected by default).
    const mime = resolveImportMime(fetched.buffer, fetched.contentType, new URL(fetched.finalUrl.href).pathname);

    // Exact MIME policy check.
    const exactMimeCheck = checkUploadPolicy(token, { storage, mime, sizeBytes, folderPath, request });
    if (!exactMimeCheck.ok) {
      return apiError(exactMimeCheck.code, exactMimeCheck.message, exactMimeCheck.status);
    }

    checkStorageLimit(storage, sizeBytes);

    const sha256 = await sha256HexBuffer(fetched.buffer);

    // Content dedup (requirement #11).
    if (deduplicate) {
      try {
        const existing = await env.img_url.get(`sha_dup:${sha256}`, { type: 'json' });
        if (existing?.directId) {
          const origin = new URL(request.url).origin;
          const responseBody = {
            data: {
              file: {
                id: existing.fileId,
                name: existing.fileName,
                size: Number(existing.size || sizeBytes),
                mime: existing.mime || mime,
                sha256,
                storage: existing.storage || storage,
              },
              links: {
                download: `${origin}/file/${encodeURIComponent(existing.directId)}`,
                share: null,
              },
              source: { url: fetched.finalUrl.href },
              deduplicated: true,
            },
          };
          await saveIdempotentResponse(env, replayKey, responseBody, 200);
          return apiSuccess(responseBody);
        }
      } catch { /* dedup index read failure is non-fatal */ }
    }

    // File name: custom > upstream basename.
    let fileName = customFileName;
    if (!fileName) {
      const upstream = decodeURIComponent((new URL(fetched.finalUrl.href).pathname.split('/').pop() || '').split('?')[0]);
      fileName = upstream || `import_${Date.now()}.${getExtensionFromMime(mime)}`;
    }
    if (!fileName.includes('.')) {
      fileName = `${fileName}.${getExtensionFromMime(mime)}`;
    }

    const dispatcher = STORAGE_DISPATCHERS[storage];
    const uploadResult = await dispatcher(env, {
      bytes: new Uint8Array(fetched.buffer),
      mime,
      fileName,
      extension: fileName.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin',
      fileSize: sizeBytes,
      folderPath,
    });

    // Record dedup index.
    if (deduplicate) {
      try {
        await env.img_url.put(`sha_dup:${sha256}`, JSON.stringify({
          fileId: uploadResult.fileId,
          directId: uploadResult.directId,
          storage,
          fileName,
          mime,
          size: sizeBytes,
          createdAt: Date.now(),
        }), { expirationTtl: DEDUP_TTL_SECONDS });
      } catch { /* dedup index write failure is non-fatal */ }
    }

    const origin = new URL(request.url).origin;
    const responseBody = {
      data: {
        file: {
          id: uploadResult.fileId,
          name: fileName,
          size: sizeBytes,
          mime,
          sha256,
          storage,
        },
        links: {
          download: `${origin}/file/${encodeURIComponent(uploadResult.directId)}`,
          share: null,
        },
        source: { url: fetched.finalUrl.href },
        deduplicated: false,
      },
    };
    await saveIdempotentResponse(env, replayKey, responseBody, 201);
    return apiSuccess(responseBody, 201);
  } catch (error) {
    if (error instanceof ImportError) {
      return apiError(error.code, error.message, error.status);
    }
    console.error('Import failed:', error?.message || error);
    return apiError('IMPORT_FAILED', error?.message ? String(error.message).slice(0, 300) : 'Import failed.', 500);
  }
}

export async function onRequest(context) {
  return apiError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
}
