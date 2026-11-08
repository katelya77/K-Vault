import { onRequestPost as uploadInternal } from '../../upload.js';
import { parseSignedTelegramFileId, shouldWriteTelegramMetadata } from '../../utils/telegram.js';
import { checkUploadPolicy } from '../../utils/policy-enforce.js';
import { normalizeFolderPath } from '../../utils/folder-path.js';
import { apiError, apiSuccess, buildAbsoluteUrl, parsePositiveInt, readIdempotentResponse, saveIdempotentResponse } from '../../utils/api-v1.js';

const STORAGE_PREFIXES = ['r2:', 's3:', 'discord:', 'hf:', 'webdav:', 'github:', 'img:', 'vid:', 'aud:', 'doc:', ''];
const SHARE_SLUG_KEY_PREFIX = 'share_slug:';
const DEDUP_TTL_SECONDS = 90 * 24 * 3600;
const DEDUP_MAX_INLINE_BYTES = 25 * 1024 * 1024; // pre-upload dedup only for small files

async function sha256HexBuffer(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function idempotencyStoreKey(tokenId, rawKey) {
  return `idem:${String(tokenId || 'anon')}:${fnv1aHex(String(rawKey || ''))}`;
}

function fnv1aHex(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

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

function randomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let output = '';
  for (let i = 0; i < length; i += 1) {
    output += chars[bytes[i] % chars.length];
  }
  return output;
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(String(input || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function findRecordByFileId(env, fileId) {
  if (!env?.img_url) return null;

  const candidates = [];
  const seen = new Set();
  const pushCandidate = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  const rawId = String(fileId || '').trim();
  pushCandidate(rawId);

  const signed = await parseSignedTelegramFileId(rawId, env);
  if (signed) {
    const extension = signed.fileExtension || 'bin';
    pushCandidate(`${signed.fileId}.${extension}`);
    pushCandidate(signed.fileId);
  }

  const hasKnownPrefix = STORAGE_PREFIXES.some((prefix) => prefix && rawId.startsWith(prefix));
  if (!hasKnownPrefix && !signed) {
    STORAGE_PREFIXES.forEach((prefix) => pushCandidate(`${prefix}${rawId}`));
  }

  for (const key of candidates) {
    const record = await env.img_url.getWithMetadata(key);
    if (record?.metadata) {
      return { key, record };
    }
  }

  return null;
}

function sanitizeSlug(rawValue = '') {
  const normalized = String(rawValue || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  return normalized.slice(0, 64);
}

async function applyApiUploadMetadata(env, key, originalMetadata, options = {}) {
  if (!env?.img_url || !key) return;

  const nextMetadata = {
    ...(originalMetadata || {}),
  };
  const oldSlug = sanitizeSlug(originalMetadata?.shareSlug || '');

  const expiresIn = parsePositiveInt(options.expiresIn, { defaultValue: 0, min: 1, max: 3650 * 24 * 3600 });
  if (expiresIn > 0) {
    nextMetadata.shareExpiresAt = Date.now() + expiresIn * 1000;
  }

  const maxDownloads = parsePositiveInt(options.maxDownloads, { defaultValue: 0, min: 1, max: 1000000000 });
  if (maxDownloads > 0) {
    nextMetadata.shareMaxDownloads = maxDownloads;
    if (!Number.isFinite(Number(nextMetadata.shareDownloadCount))) {
      nextMetadata.shareDownloadCount = 0;
    }
  }

  const slug = sanitizeSlug(options.slug);
  if (slug) {
    nextMetadata.shareSlug = slug;
  }

  const password = String(options.password || '');
  if (password) {
    const salt = randomString(12);
    const hash = await sha256Hex(`${salt}:${password}`);
    nextMetadata.sharePasswordSalt = salt;
    nextMetadata.sharePasswordHash = hash;
  }

  if (slug) {
    const existing = await env.img_url.get(`${SHARE_SLUG_KEY_PREFIX}${slug}`);
    if (existing && String(existing) !== String(key)) {
      throw new Error('自定义短链标识已被占用。');
    }
  }

  await env.img_url.put(key, '', { metadata: nextMetadata });

  if (slug && oldSlug && oldSlug !== slug) {
    await env.img_url.delete(`${SHARE_SLUG_KEY_PREFIX}${oldSlug}`);
  }
  if (slug) {
    await env.img_url.put(`${SHARE_SLUG_KEY_PREFIX}${slug}`, key, {
      metadata: {
        fileId: key,
        updatedAt: Date.now(),
      },
    });
  }

  return nextMetadata;
}

function extractUploadResultId(payload) {
  if (Array.isArray(payload)) {
    const src = payload[0]?.src;
    if (!src) return '';
    return String(src).replace(/^\/file\//, '');
  }

  if (payload && typeof payload === 'object' && payload.src) {
    return String(payload.src).replace(/^\/file\//, '');
  }

  return '';
}

function mapMimeType(fileName = '', fallback = 'application/octet-stream') {
  const extension = String(fileName || '').split('.').pop()?.toLowerCase();
  const map = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    txt: 'text/plain',
    json: 'application/json',
    pdf: 'application/pdf',
  };
  return map[extension] || fallback;
}

function resolveUploadErrorStatus(status, message) {
  if (status === 413) return 413;
  const text = String(message || '').toLowerCase();
  if (text.includes('size limit') || text.includes('too large') || text.includes('limit exceeded')) {
    return 413;
  }
  if (status >= 400 && status < 600) return status;
  return 500;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const apiToken = context.data?.apiToken || null;
  // Idempotency replay (requirement #11): same key returns the saved response.
  const idempotencyKey = String(request.headers.get('Idempotency-Key') || '').trim().slice(0, 200);
  const replayKey = idempotencyKey ? idempotencyStoreKey(apiToken?.id, idempotencyKey) : '';
  const replay = await readIdempotentResponse(env, replayKey);
  if (replay) return replay;

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return apiError('BAD_REQUEST', '请求必须使用 multipart/form-data 格式。', 400);
  }

  const file = formData.get('file');
  if (!file) {
    return apiError('VALIDATION_ERROR', '缺少必填字段 "file"。', 400);
  }

  const url = new URL(request.url);
  const storage = String(formData.get('storage') || url.searchParams.get('storage') || '').trim().toLowerCase();
  const password = String(formData.get('password') || url.searchParams.get('password') || '');
  const expiresIn = String(formData.get('expires_in') || url.searchParams.get('expires_in') || '');
  const maxDownloads = String(formData.get('max_downloads') || url.searchParams.get('max_downloads') || '');
  const slug = String(formData.get('slug') || url.searchParams.get('slug') || '');
  const normalizedSlug = sanitizeSlug(slug);
  if (slug && !normalizedSlug) {
    return apiError('VALIDATION_ERROR', '字段 "slug" 只能包含字母、数字、下划线或短横线。', 400);
  }

  // Per-token policy enforcement (requirement #10).
  const folderPath = normalizeFolderPath(formData.get('folderPath') || formData.get('folder') || url.searchParams.get('folder'));
  const deduplicate = String(formData.get('deduplicate') || url.searchParams.get('deduplicate') || '').toLowerCase() === 'true';
  const policyCheck = checkUploadPolicy(apiToken, {
    storage,
    mime: file.type || mapMimeType(file.name, ''),
    sizeBytes: file.size,
    folderPath,
    request,
  });
  if (!policyCheck.ok) {
    return apiError(policyCheck.code, policyCheck.message, policyCheck.status);
  }

  // Content dedup for small uploads (requirement #11): identical content returns the existing object.
  let contentSha256 = '';
  if (deduplicate && file.size > 0 && file.size <= DEDUP_MAX_INLINE_BYTES && env?.img_url) {
    try {
      const bytes = await file.arrayBuffer();
      contentSha256 = await sha256HexBuffer(bytes);
      const existing = await env.img_url.get(`sha_dup:${contentSha256}`, { type: 'json' });
      if (existing?.publicId) {
        const dedupBody = {
          success: true,
          file: {
            id: existing.publicId,
            name: existing.fileName || file.name,
            size: Number(existing.size || file.size),
            type: existing.mime || file.type || mapMimeType(file.name, 'application/octet-stream'),
            storage: existing.storage || storage || 'telegram',
            uploadedAt: existing.uploadedAt || new Date().toISOString(),
            sha256: contentSha256,
          },
          links: {
            download: buildAbsoluteUrl(request, `/file/${encodeURIComponent(existing.publicId)}`),
            share: buildAbsoluteUrl(request, `/s/${encodeURIComponent(existing.publicId)}`),
            delete: buildAbsoluteUrl(request, `/api/v1/file/${encodeURIComponent(existing.publicId)}`),
          },
          deduplicated: true,
        };
        await saveIdempotentResponse(env, replayKey, dedupBody, 200);
        return apiSuccess(dedupBody);
      }
    } catch { /* dedup failures fall through to a normal upload */ }
  }

  const uploadForm = new FormData();
  for (const [key, value] of formData.entries()) {
    if (key === 'storage') continue;
    uploadForm.append(key, value);
  }
  if (storage) {
    uploadForm.set('storageMode', storage);
  }
  uploadForm.set('folderPath', folderPath);

  const headers = new Headers(request.headers);
  headers.delete('content-type');
  headers.delete('Content-Type');
  headers.delete('content-length');
  headers.delete('Content-Length');

  const proxiedRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: uploadForm,
  });

  const uploadResponse = await uploadInternal({
    ...context,
    request: proxiedRequest,
  });

  let uploadPayload = null;
  try {
    uploadPayload = await uploadResponse.clone().json();
  } catch {
    uploadPayload = null;
  }

  if (!uploadResponse.ok) {
    const message = uploadPayload?.error || uploadPayload?.message || '上传失败。';
    const status = resolveUploadErrorStatus(uploadResponse.status || 500, message);
    const code = status === 413 ? 'FILE_TOO_LARGE' : 'UPLOAD_FAILED';
    return apiError(code, message, status);
  }

  const publicId = extractUploadResultId(uploadPayload);
  if (!publicId) {
    return apiError('UPLOAD_FAILED', '上传响应中缺少文件标识。', 502);
  }

  // Low-write mode: signed Telegram uploads skip the post-upload KV metadata
  // probe entirely (password/expires_in/max_downloads/slug are ignored and
  // no delete link is returned).
  const signedTelegram = await parseSignedTelegramFileId(publicId, env);
  const skipTelegramMetadata = Boolean(signedTelegram) && !shouldWriteTelegramMetadata(env);
  const lookup = skipTelegramMetadata
    ? null
    : await findRecordByFileId(env, publicId);
  let metadata = lookup?.record?.metadata || {};
  if (lookup?.key) {
    try {
      metadata = await applyApiUploadMetadata(env, lookup.key, lookup.record?.metadata || {}, {
        password,
        expiresIn,
        maxDownloads,
        slug: normalizedSlug,
      });
    } catch (error) {
      const message = error?.message || '写入上传元数据失败。';
      if (message.includes('已被占用')) {
        return apiError('SLUG_CONFLICT', message, 409);
      }
      return apiError('UPLOAD_METADATA_FAILED', message, 500);
    }
  }

  const canonicalId = lookup?.key || publicId;
  const fileName = metadata.fileName || file.name || signedTelegram?.fileName || canonicalId;
  const fileSize = Number(metadata.fileSize || signedTelegram?.fileSize || file.size || 0);
  const uploadedAtValue = Number(metadata.TimeStamp || signedTelegram?.timestamp || Date.now());
  const shareSlug = lookup?.key
    ? (sanitizeSlug(metadata.shareSlug || '') || normalizedSlug)
    : '';
  const shareId = shareSlug || publicId;

  const responseBody = {
    file: {
      id: canonicalId,
      name: fileName,
      size: fileSize,
      type: mapMimeType(fileName, file.type || 'application/octet-stream'),
      storage: normalizeStorageType(canonicalId, metadata),
      uploadedAt: new Date(uploadedAtValue).toISOString(),
    },
    links: {
      download: buildAbsoluteUrl(request, `/file/${encodeURIComponent(publicId)}`),
      share: buildAbsoluteUrl(request, `/s/${encodeURIComponent(shareId)}`),
      delete: skipTelegramMetadata
        ? null
        : buildAbsoluteUrl(request, `/api/v1/file/${encodeURIComponent(canonicalId)}`),
    },
  };
  await saveIdempotentResponse(env, replayKey, responseBody, 200);
  if (contentSha256) {
    const { name, size, type, storage, uploadedAt } = responseBody.file;
    try {
      await env.img_url.put(`sha_dup:${contentSha256}`, JSON.stringify({
        publicId, fileName: name, size, mime: type, storage, uploadedAt,
      }), { expirationTtl: DEDUP_TTL_SECONDS });
    } catch { /* dedup index failures are non-fatal */ }
  }
  return apiSuccess(responseBody);
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return apiError('METHOD_NOT_ALLOWED', '请求方法不被允许。', 405);
  }
  return onRequestPost(context);
}

