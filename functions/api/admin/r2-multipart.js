import { apiError, apiSuccess } from '../../utils/api-v1.js';
import { normalizeFolderPath } from '../../utils/folder-path.js';
import { getFileExtension } from '../../utils/telegram.js';
import {
  getR2MultipartMaxBytes,
  R2_MULTIPART_MIN_BYTES,
  R2_MULTIPART_PART_BYTES,
} from '../../utils/r2-multipart.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

class MultipartError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function encodeBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}

function importSessionKey(env) {
  const secret = encoder.encode(JSON.stringify(['kvault-r2-multipart-v1', env.BASIC_USER, env.BASIC_PASS]));
  return crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function readSession(request, key) {
  const token = request.headers.get('X-Upload-Session') || '';
  if (token.length <= 8192 && /^[\w-]+\.[\w-]{43}$/.test(token)) {
    try {
      const [payload, signature] = token.split('.');
      const verified = await crypto.subtle.verify('HMAC', key, decodeBase64Url(signature), encoder.encode(payload));
      if (verified) return JSON.parse(decoder.decode(decodeBase64Url(payload)));
    } catch { /* an unreadable token is an invalid session */ }
  }
  throw new MultipartError('INVALID_SESSION', '上传会话无效，请重新选择文件。', 403);
}

async function readBoundedBody(request, limit) {
  if (Number(request.headers.get('Content-Length')) > limit) {
    throw new MultipartError('BODY_TOO_LARGE', '请求体超过允许大小。', 413);
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const buffer = new Uint8Array(limit);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return buffer.subarray(0, offset);
      if (offset + value.byteLength > limit) {
        await reader.cancel();
        throw new MultipartError('BODY_TOO_LARGE', '请求体超过允许大小。', 413);
      }
      buffer.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
}

async function readJson(request, limit) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new MultipartError('INVALID_CONTENT_TYPE', '请使用 application/json。', 415);
  }
  const bytes = await readBoundedBody(request, limit);
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    throw new MultipartError('INVALID_JSON', '无效的 JSON 请求。');
  }
}

function fileMetadata(session) {
  return {
    TimeStamp: session.createdAt,
    ListType: 'None',
    Label: 'None',
    liked: false,
    fileName: session.fileName,
    fileSize: session.fileSize,
    storageType: 'r2',
    r2Key: session.objectKey,
    ...(session.folderPath ? { folderPath: session.folderPath } : {}),
  };
}

async function beginUpload(request, bucket, key, maxBytes) {
  const input = await readJson(request, 4096);
  const { fileName, fileSize } = input || {};
  if (typeof fileName !== 'string' || !fileName.trim() || /[\x00-\x1f\x7f]/.test(fileName) ||
      !Number.isSafeInteger(fileSize) || fileSize < R2_MULTIPART_MIN_BYTES) {
    throw new MultipartError('INVALID_FILE', '请选择超过 100 MiB 的有效文件。');
  }
  if (fileSize > maxBytes) {
    throw new MultipartError('FILE_TOO_LARGE', 'R2 分片上传的单文件上限为 20 GiB。', 413);
  }

  const fileType = typeof input.fileType === 'string' && /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(input.fileType)
    ? input.fileType : 'application/octet-stream';
  const objectKey = `r2_${crypto.randomUUID()}.${getFileExtension(fileName, fileType)}`;
  const createdAt = Date.now();
  const session = {
    objectKey, fileName, fileSize, createdAt,
    folderPath: normalizeFolderPath(typeof input.folderPath === 'string' ? input.folderPath : ''),
    partSize: R2_MULTIPART_PART_BYTES,
    expiresAt: createdAt + SESSION_TTL_MS,
  };
  if (encoder.encode(JSON.stringify(fileMetadata(session))).byteLength > 1024) {
    throw new MultipartError('METADATA_TOO_LONG', '文件名和目录路径太长。');
  }
  const upload = await bucket.createMultipartUpload(objectKey, {
    httpMetadata: { contentType: fileType },
    customMetadata: { fileName, kvaultMultipart: objectKey },
  });
  try {
    session.uploadId = upload.uploadId;
    const payload = encodeBase64Url(encoder.encode(JSON.stringify(session)));
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    return apiSuccess({
      session: `${payload}.${encodeBase64Url(new Uint8Array(signature))}`,
      partSize: session.partSize,
      expiresAt: session.expiresAt,
    }, 201);
  } catch (error) {
    try { await upload.abort(); } catch { /* R2 lifecycle reclaims an incomplete upload */ }
    throw error;
  }
}

function isR2Error(error, number, name) {
  return String(error?.code) === number || error?.code === name ||
    String(error?.message).match(/\b\d{5}\b/g)?.includes(number) || error?.name === name;
}

async function findCompletedObject(bucket, session) {
  const object = await bucket.head(session.objectKey);
  return object?.size === session.fileSize && object.customMetadata?.kvaultMultipart === session.objectKey
    ? object : null;
}

async function publishObject(env, session, recovering = true) {
  const key = `r2:${session.objectKey}`;
  try {
    const existing = recovering ? await env.img_url.getWithMetadata(key) : null;
    if (!existing?.metadata) {
      await env.img_url.put(key, '', { metadata: fileMetadata(session) });
    }
  } catch {
    // The object is complete. A retry can repair the index without uploading or deleting bytes.
    throw new MultipartError('INDEX_PENDING', 'R2 已接收文件，索引暂未写入，请重试完成上传。', 503);
  }
  return apiSuccess({ src: `/file/${key}` });
}

async function uploadPart(request, upload, session, partNumber, totalParts) {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > totalParts) {
    throw new MultipartError('INVALID_PART', '分片编号超出范围。');
  }
  const expected = Math.min(session.partSize, session.fileSize - (partNumber - 1) * session.partSize);
  const bytes = await readBoundedBody(request, expected);
  if (bytes.byteLength !== expected) {
    throw new MultipartError('INVALID_PART_SIZE', '分片大小与上传会话不一致。');
  }
  const part = await upload.uploadPart(partNumber, bytes);
  return apiSuccess({ part });
}

async function completeUpload(request, env, upload, session, totalParts) {
  const { parts } = await readJson(request, 512 * 1024) || {};
  if (!Array.isArray(parts) || parts.length !== totalParts ||
      parts.some((part, index) => part?.partNumber !== index + 1 ||
        typeof part.etag !== 'string' || !part.etag)) {
    throw new MultipartError('INVALID_MANIFEST', '请提交所有分片的有序回执。');
  }
  try {
    const object = await upload.complete(parts.map(({ partNumber, etag }) => ({ partNumber, etag })));
    if (object.size !== session.fileSize) {
      throw new MultipartError('INVALID_OBJECT_SIZE', 'R2 对象大小与上传会话不一致。', 502);
    }
  } catch (error) {
    // R2 may have completed the upload before a response was lost, or before a concurrent retry.
    if (await findCompletedObject(env.R2_BUCKET, session)) return publishObject(env, session);
    if (isR2Error(error, '10025', 'InvalidPart')) {
      throw new MultipartError('STALE_PARTS', 'R2 的分片回执已变更，请重试上传。', 409);
    }
    throw error;
  }
  return publishObject(env, session, false);
}

// /api/admin/_middleware.js requires configured admin authentication on every request.
export async function onRequest({ request, env }) {
  const maxBytes = getR2MultipartMaxBytes(env);
  if (!maxBytes) return apiError('R2_MULTIPART_UNAVAILABLE', 'R2 分片上传需要 R2、KV 和管理员认证。', 503);

  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return apiError('INVALID_ORIGIN', '请从本站上传。', 403);
  const action = url.searchParams.get('action');
  try {
    const key = await importSessionKey(env);
    if (request.method === 'POST' && !action) return await beginUpload(request, env.R2_BUCKET, key, maxBytes);
    const session = await readSession(request, key);
    const upload = env.R2_BUCKET.resumeMultipartUpload(session.objectKey, session.uploadId);
    const totalParts = Math.ceil(session.fileSize / session.partSize);

    if (request.method === 'DELETE') {
      try {
        await upload.abort();
      } catch (error) {
        if (!isR2Error(error, '10024', 'NoSuchUpload')) throw error;
      }
      if (await findCompletedObject(env.R2_BUCKET, session)) return await publishObject(env, session);
      return apiSuccess({ aborted: true });
    }
    if (session.expiresAt <= Date.now()) throw new MultipartError('EXPIRED_SESSION', '上传会话已过期。', 410);
    if (request.method === 'PUT') {
      try {
        return await uploadPart(request, upload, session, Number(url.searchParams.get('part')), totalParts);
      } catch (error) {
        if (isR2Error(error, '10024', 'NoSuchUpload') && await findCompletedObject(env.R2_BUCKET, session)) {
          return await publishObject(env, session);
        }
        throw error;
      }
    }
    if (request.method === 'POST' && action === 'complete') {
      return await completeUpload(request, env, upload, session, totalParts);
    }
    return apiError('METHOD_NOT_ALLOWED', '请求方法不受支持。', 405);
  } catch (error) {
    if (error instanceof MultipartError) return apiError(error.code, error.message, error.status);
    if (isR2Error(error, '10024', 'NoSuchUpload')) return apiError('EXPIRED_SESSION', '上传会话已失效。', 410);
    if (isR2Error(error, '10058', 'TooManyRequests')) return apiError('R2_BUSY', 'R2 正忙，请稍后重试。', 429);
    return apiError('R2_MULTIPART_FAILED', 'R2 分片操作失败，请重试。', 503);
  }
}
