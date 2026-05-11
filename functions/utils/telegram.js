const DEFAULT_TELEGRAM_API_BASE = "https://api.telegram.org";

const MIME_EXTENSION_MAP = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/flac": "flac",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/x-7z-compressed": "7z",
  "application/x-rar-compressed": "rar",
  "text/plain": "txt",
  "application/json": "json",
};

function normalizeTelegramApiBase(raw) {
  if (!raw || typeof raw !== "string") return DEFAULT_TELEGRAM_API_BASE;
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_TELEGRAM_API_BASE;

  try {
    const parsed = new URL(trimmed);
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return DEFAULT_TELEGRAM_API_BASE;
  }
}

export function getTelegramApiBase(env) {
  return normalizeTelegramApiBase(env?.CUSTOM_BOT_API_URL);
}

export function buildTelegramBotApiUrl(env, method) {
  const base = getTelegramApiBase(env);
  const normalizedMethod = String(method || "").replace(/^\/+/, "");
  return `${base}/bot${env.TG_Bot_Token}/${normalizedMethod}`;
}

export function buildTelegramFileUrl(env, filePath) {
  const base = getTelegramApiBase(env);
  const normalizedPath = String(filePath || "").replace(/^\/+/, "");
  return `${base}/file/bot${env.TG_Bot_Token}/${normalizedPath}`;
}

export function getTelegramUploadMethodAndField(contentType = "") {
  const type = String(contentType || "").toLowerCase();
  if (type.startsWith("image/")) {
    return { method: "sendPhoto", field: "photo" };
  }
  if (type.startsWith("audio/")) {
    return { method: "sendAudio", field: "audio" };
  }
  if (type.startsWith("video/")) {
    return { method: "sendVideo", field: "video" };
  }
  return { method: "sendDocument", field: "document" };
}

export function pickTelegramFileId(responseData) {
  if (!responseData?.ok || !responseData.result) return null;
  const result = responseData.result;
  if (Array.isArray(result.photo) && result.photo.length) {
    return result.photo.reduce((prev, current) =>
      (prev?.file_size || 0) > (current?.file_size || 0) ? prev : current
    )?.file_id;
  }
  if (result.document?.file_id) return result.document.file_id;
  if (result.video?.file_id) return result.video.file_id;
  if (result.audio?.file_id) return result.audio.file_id;
  if (result.voice?.file_id) return result.voice.file_id;
  if (result.animation?.file_id) return result.animation.file_id;
  if (result.video_note?.file_id) return result.video_note.file_id;
  return null;
}

export function guessExtensionFromMimeType(mimeType, fallback = "bin") {
  const normalized = String(mimeType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  return MIME_EXTENSION_MAP[normalized] || fallback;
}

export function getFileExtension(fileName, mimeType, fallback = "bin") {
  const fromName = String(fileName || "").split(".").pop()?.toLowerCase();
  if (fromName && fromName !== fileName?.toLowerCase()) {
    return sanitizeFileExtension(fromName, fallback);
  }
  if (String(fileName || "").includes(".")) {
    return sanitizeFileExtension(fromName, fallback);
  }
  return sanitizeFileExtension(
    guessExtensionFromMimeType(mimeType, fallback),
    fallback
  );
}

export function sanitizeFileExtension(ext, fallback = "bin") {
  const normalized = String(ext || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!normalized) return fallback;
  return normalized.slice(0, 10);
}

function base64UrlEncode(input) {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecodeToBytes(input) {
  const base64 = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeToString(input) {
  return new TextDecoder().decode(base64UrlDecodeToBytes(input));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function signPayload(payload, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );
  return base64UrlEncode(new Uint8Array(sig));
}

export function shouldUseSignedTelegramLinks(env) {
  const mode = String(env?.TELEGRAM_LINK_MODE || "").toLowerCase();
  if (mode === "signed") return true;
  return env?.MINIMIZE_KV_WRITES === "true";
}

export function shouldWriteTelegramMetadata(env) {
  const metadataMode = String(env?.TELEGRAM_METADATA_MODE || "")
    .trim()
    .toLowerCase();
  if (["off", "none", "disable", "disabled", "minimal"].includes(metadataMode)) {
    return false;
  }
  if (["on", "full", "always", "enable", "enabled"].includes(metadataMode)) {
    return true;
  }

  const skipMetadata = String(env?.TELEGRAM_SKIP_METADATA || "")
    .trim()
    .toLowerCase();
  if (["1", "true", "yes", "on"].includes(skipMetadata)) {
    return false;
  }

  // Default to writing lightweight metadata so admin list and management actions keep working.
  return true;
}

function normalizeBaseUrl(raw) {
  if (!raw) return "";
  try {
    return new URL(String(raw)).toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function formatFileSize(bytes) {
  const numeric = Number(bytes || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "0 B";
  if (numeric < 1024) return `${numeric} B`;
  if (numeric < 1024 * 1024) return `${(numeric / 1024).toFixed(2)} KB`;
  if (numeric < 1024 * 1024 * 1024) {
    return `${(numeric / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(numeric / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function isFlagEnabled(rawValue, defaultValue) {
  const normalized = String(rawValue ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return defaultValue;
  if (["1", "true", "yes", "on", "enable", "enabled"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off", "disable", "disabled"].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

export function shouldNotifyTelegramUpload(env) {
  return isFlagEnabled(
    env?.TG_UPLOAD_NOTIFY ?? env?.TELEGRAM_UPLOAD_NOTIFY,
    true
  );
}

export function buildTelegramDirectLink(env, directId, fallbackOrigin = "") {
  const publicBase = normalizeBaseUrl(env?.PUBLIC_BASE_URL);
  const fallbackBase = normalizeBaseUrl(fallbackOrigin);
  const base = publicBase || fallbackBase;
  if (!base) return `/api/v4/file/get/${directId}`;
  return `${base}/api/v4/file/get/${directId}`;
}

export function buildTelegramUploadNoticeText({
  directLink,
  fileId,
  messageId,
  fileName,
  fileSize,
}) {
  const safeName = truncateFileName(fileName || "", 120) || "unnamed";
  const lines = [
    "Upload completed",
    `Name: ${safeName}`,
    `Size: ${formatFileSize(fileSize)}`,
    `Direct Link: ${directLink}`,
    `File ID: ${fileId}`,
  ];
  if (messageId) lines.push(`Message ID: ${messageId}`);
  return lines.join("\n");
}

async function postTelegramMessage(payload, env) {
  const response = await fetch(buildTelegramBotApiUrl(env, "sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok && data?.ok, data };
}

export async function sendTelegramUploadNotice(
  {
    chatId,
    replyToMessageId,
    directLink,
    fileId,
    messageId,
    fileName,
    fileSize,
    text,
  },
  env
) {
  if (!shouldNotifyTelegramUpload(env)) {
    return { ok: false, skipped: true, reason: "disabled" };
  }

  const targetChatId = chatId || env?.TG_Chat_ID;
  if (!targetChatId || !env?.TG_Bot_Token) {
    return { ok: false, skipped: true, reason: "missing-config" };
  }

  const finalText =
    text ||
    buildTelegramUploadNoticeText({
      directLink,
      fileId,
      messageId,
      fileName,
      fileSize,
    });

  const payload = {
    chat_id: targetChatId,
    text: finalText,
    disable_web_page_preview: true,
  };

  if (replyToMessageId) {
    payload.reply_to_message_id = Number(replyToMessageId);
    payload.allow_sending_without_reply = true;
  }

  try {
    let result = await postTelegramMessage(payload, env);
    if (!result.ok && payload.reply_to_message_id) {
      // Some channel configurations reject replies. Retry once without reply target.
      const fallbackPayload = {
        chat_id: targetChatId,
        text: finalText,
        disable_web_page_preview: true,
      };
      result = await postTelegramMessage(fallbackPayload, env);
    }
    return result;
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function getFileLinkSecrets(env) {
  const candidates = [
    env?.FILE_URL_SECRET,
    env?.TG_FILE_URL_SECRET,
    env?.TG_Bot_Token,
    "k-vault-default-secret",
    // Legacy fallback keeps previously signed links valid.
    "tgbed-default-secret",
  ];

  return [...new Set(candidates
    .map((item) => (item == null ? "" : String(item).trim()))
    .filter(Boolean))];
}

function truncateFileName(fileName, limit = 180) {
  if (!fileName) return "";
  const str = String(fileName);
  if (str.length <= limit) return str;
  return str.slice(0, limit);
}

export async function createSignedTelegramFileId(
  { fileId, fileExtension, fileName, mimeType, fileSize, messageId },
  env
) {
  const ext = sanitizeFileExtension(fileExtension || "bin");
  const payloadObj = {
    v: 1,
    f: String(fileId || ""),
    e: ext,
    n: truncateFileName(fileName || ""),
    m: String(mimeType || ""),
    s: Number(fileSize || 0),
    t: Date.now(),
    mid: messageId ? Number(messageId) : undefined,
  };
  const payload = base64UrlEncode(JSON.stringify(payloadObj));
  const [primarySecret] = getFileLinkSecrets(env);
  const signature = await signPayload(payload, primarySecret);
  return `tgs_${payload}.${signature}.${ext}`;
}

export async function parseSignedTelegramFileId(id, env) {
  const raw = String(id || "");
  const match = /^tgs_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)(?:\.([A-Za-z0-9]+))?$/.exec(
    raw
  );
  if (!match) return null;

  const payload = match[1];
  const signature = match[2];
  const extFromSuffix = sanitizeFileExtension(match[3] || "bin");
  const secrets = getFileLinkSecrets(env);
  let isValid = false;

  for (const secret of secrets) {
    const expected = await signPayload(payload, secret);
    if (timingSafeEqual(signature, expected)) {
      isValid = true;
      break;
    }
  }

  if (!isValid) return null;

  let parsed;
  try {
    parsed = JSON.parse(base64UrlDecodeToString(payload));
  } catch {
    return null;
  }
  if (!parsed?.f) return null;

  return {
    version: parsed.v || 1,
    fileId: String(parsed.f),
    fileExtension: sanitizeFileExtension(parsed.e || extFromSuffix || "bin"),
    fileName: parsed.n ? String(parsed.n) : "",
    mimeType: parsed.m ? String(parsed.m) : "",
    fileSize: Number(parsed.s || 0),
    timestamp: Number(parsed.t || 0),
    messageId: parsed.mid ? Number(parsed.mid) : null,
  };
}

export function getTelegramFileFromMessage(message) {
  if (!message) return null;

  if (Array.isArray(message.photo) && message.photo.length) {
    const photo = message.photo.reduce((prev, current) =>
      (prev?.file_size || 0) > (current?.file_size || 0) ? prev : current
    );
    const ext = "jpg";
    const fileName = `photo_${message.message_id || Date.now()}.${ext}`;
    return {
      kind: "photo",
      fileId: photo.file_id,
      fileUniqueId: photo.file_unique_id || "",
      mimeType: "image/jpeg",
      fileSize: Number(photo.file_size || 0),
      fileExtension: ext,
      fileName,
      messageId: Number(message.message_id || 0),
    };
  }

  const candidates = [
    { key: "document", fallbackName: "document", fallbackMime: "application/octet-stream" },
    { key: "video", fallbackName: "video", fallbackMime: "video/mp4" },
    { key: "audio", fallbackName: "audio", fallbackMime: "audio/mpeg" },
    { key: "voice", fallbackName: "voice", fallbackMime: "audio/ogg" },
    { key: "animation", fallbackName: "animation", fallbackMime: "video/mp4" },
    { key: "video_note", fallbackName: "video_note", fallbackMime: "video/mp4" },
    { key: "sticker", fallbackName: "sticker", fallbackMime: "image/webp" },
  ];

  for (const item of candidates) {
    const data = message[item.key];
    if (!data?.file_id) continue;

    const mimeType = data.mime_type || item.fallbackMime;
    const ext = getFileExtension(data.file_name, mimeType, "bin");
    const fileName = data.file_name || `${item.fallbackName}_${message.message_id || Date.now()}.${ext}`;
    return {
      kind: item.key,
      fileId: data.file_id,
      fileUniqueId: data.file_unique_id || "",
      mimeType,
      fileSize: Number(data.file_size || 0),
      fileExtension: ext,
      fileName,
      messageId: Number(message.message_id || 0),
    };
  }

  return null;
}
