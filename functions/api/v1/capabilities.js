import { apiSuccess } from '../../utils/api-v1.js';

/**
 * GET /api/v1/capabilities (requirement #5) — public, no Bearer required.
 * Reports only storage backends that are actually configured on this
 * deployment, so agents can pick a target without probing.
 */

const API_VERSION = 'v1';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100MB (Pages hard limit)

export function detectConfiguredStorages(env) {
  const storages = [];

  // Pages uploads use the historical mixed-case bindings, while Docker
  // normalizes them to uppercase. Accept both when advertising readiness.
  const telegramBotToken = String(env.TG_BOT_TOKEN || env.TG_Bot_Token || '').trim();
  const telegramChatId = String(env.TG_CHAT_ID || env.TG_Chat_ID || '').trim();
  if (telegramBotToken && telegramChatId) {
    storages.push('telegram');
  }
  if (env.R2_BUCKET) {
    storages.push('r2');
  }
  if ((env.S3_ENDPOINT || '').trim() && (env.S3_ACCESS_KEY_ID || '').trim() && (env.S3_BUCKET || '').trim()) {
    storages.push('s3');
  }
  if ((env.DISCORD_WEBHOOK_URL || '').trim() || (env.DISCORD_BOT_TOKEN || '').trim()) {
    storages.push('discord');
  }
  if ((env.HF_TOKEN || '').trim() && (env.HF_REPO || '').trim()) {
    storages.push('huggingface');
  }
  if ((env.WEBDAV_BASE_URL || '').trim() && ((env.WEBDAV_BEARER_TOKEN || '').trim() || (env.WEBDAV_USERNAME || '').trim())) {
    storages.push('webdav');
  }
  if ((env.GITHUB_REPO || '').trim() && (env.GITHUB_TOKEN || '').trim()) {
    storages.push('github');
  }

  return storages;
}

export async function onRequestGet(context) {
  const { env } = context;
  const storages = detectConfiguredStorages(env);

  return apiSuccess({
    data: {
      apiVersion: API_VERSION,
      upload: storages.length > 0,
      importFromUrl: true,
      maxUploadSize: MAX_UPLOAD_SIZE,
      storages,
      imageTypes: IMAGE_TYPES,
    },
  });
}
