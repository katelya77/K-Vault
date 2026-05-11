import { createS3Client } from './s3client.js';
import { checkDiscordConnection } from './discord.js';
import { checkHuggingFaceConnection, hasHuggingFaceConfig } from './huggingface.js';
import { checkWebDAVConnection, hasWebDAVConfig } from './webdav.js';
import { checkGitHubConnection, hasGitHubConfig } from './github.js';
import { buildTelegramBotApiUrl, getTelegramApiBase } from './telegram.js';

const ENV_VARS = {
  telegram: ['TG_Bot_Token', 'TG_Chat_ID'],
  r2: ['R2_BUCKET'],
  s3: ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET', 'S3_REGION'],
  discord: ['DISCORD_WEBHOOK_URL', 'DISCORD_BOT_TOKEN', 'DISCORD_CHANNEL_ID'],
  huggingface: ['HF_TOKEN', 'HF_REPO'],
  webdav: ['WEBDAV_BASE_URL', 'WEBDAV_USERNAME', 'WEBDAV_PASSWORD', 'WEBDAV_BEARER_TOKEN', 'WEBDAV_TOKEN', 'WEBDAV_ROOT_PATH'],
  github: ['GITHUB_REPO', 'GITHUB_TOKEN', 'GITHUB_MODE', 'GITHUB_PREFIX', 'GITHUB_PATH', 'GITHUB_RELEASE_TAG', 'GITHUB_BRANCH', 'GITHUB_API_BASE'],
};

const KV_PREFIX = 'storage:health:';

function collectSnapshot(env) {
  const snapshot = {};
  for (const [type, vars] of Object.entries(ENV_VARS)) {
    const values = {};
    for (const v of vars) {
      values[v] = env[v] || '';
    }
    snapshot[type] = values;
  }
  return snapshot;
}

async function hashSnapshot(snapshot) {
  const json = JSON.stringify(snapshot);
  const bytes = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function checkBackend(type, env) {
  switch (type) {
    case 'telegram': {
      if (!env.TG_Bot_Token || !env.TG_Chat_ID) {
        return { connected: false, enabled: false, configured: false, message: 'Not configured' };
      }
      try {
        const resp = await fetch(buildTelegramBotApiUrl(env, 'getMe'));
        const data = await resp.json();
        if (data?.ok) {
          return { connected: true, enabled: true, configured: true, message: `Connected: @${data.result.username}`, botName: data.result.first_name, botUsername: data.result.username, apiBase: getTelegramApiBase(env) };
        }
        return { connected: false, enabled: false, configured: true, message: data?.description || 'Telegram API check failed' };
      } catch (e) {
        return { connected: false, enabled: false, configured: true, message: e.message };
      }
    }
    case 'r2': {
      if (!env.R2_BUCKET) {
        return { connected: false, enabled: false, configured: false, message: 'Not configured' };
      }
      try {
        const result = await env.R2_BUCKET.list({ limit: 1 });
        return { connected: true, enabled: true, configured: true, message: 'Connected', hasData: Array.isArray(result?.objects) && result.objects.length > 0 };
      } catch (e) {
        return { connected: false, enabled: false, configured: true, message: e.message };
      }
    }
    case 's3': {
      if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY || !env.S3_BUCKET) {
        return { connected: false, enabled: false, configured: false, message: 'Not configured' };
      }
      try {
        const s3 = createS3Client(env);
        const connected = await s3.checkConnection();
        return { connected, enabled: connected, configured: true, message: connected ? `Connected: ${env.S3_BUCKET}` : 'S3 check failed' };
      } catch (e) {
        return { connected: false, enabled: false, configured: true, message: e.message };
      }
    }
    case 'discord': {
      if (!env.DISCORD_WEBHOOK_URL && !env.DISCORD_BOT_TOKEN) {
        return { connected: false, enabled: false, configured: false, message: 'Not configured' };
      }
      try {
        const result = await checkDiscordConnection(env);
        return { connected: Boolean(result?.connected), enabled: Boolean(result?.connected), configured: true, message: result?.connected ? `Connected (${result.mode || 'unknown'})` : 'Discord check failed', mode: result?.mode };
      } catch (e) {
        return { connected: false, enabled: false, configured: true, message: e.message };
      }
    }
    case 'huggingface': {
      if (!hasHuggingFaceConfig(env)) {
        return { connected: false, enabled: false, configured: false, message: 'Not configured' };
      }
      try {
        const result = await checkHuggingFaceConnection(env);
        return { connected: Boolean(result?.connected), enabled: Boolean(result?.connected), configured: true, message: result?.connected ? `Connected: ${result.repoId}${result.isPrivate ? ' (private)' : ''}` : (result?.error || 'HuggingFace check failed') };
      } catch (e) {
        return { connected: false, enabled: false, configured: true, message: e.message };
      }
    }
    case 'webdav': {
      if (!hasWebDAVConfig(env)) {
        return { connected: false, enabled: false, configured: false, message: 'Not configured' };
      }
      try {
        const result = await checkWebDAVConnection(env);
        return { connected: Boolean(result?.connected), enabled: Boolean(result?.connected), configured: true, message: result?.connected ? 'Connected' : (result?.message || 'WebDAV check failed'), detail: result?.detail, status: result?.status };
      } catch (e) {
        return { connected: false, enabled: false, configured: true, message: e.message };
      }
    }
    case 'github': {
      if (!hasGitHubConfig(env)) {
        return { connected: false, enabled: false, configured: false, message: 'Not configured' };
      }
      try {
        const result = await checkGitHubConnection(env);
        return { connected: Boolean(result?.connected), enabled: Boolean(result?.connected), configured: true, message: result?.connected ? 'Connected' : (result?.message || 'GitHub check failed'), mode: result?.mode, status: result?.status, detail: result?.detail };
      } catch (e) {
        return { connected: false, enabled: false, configured: true, message: e.message };
      }
    }
    default:
      return { connected: false, enabled: false, configured: false, message: 'Unknown type' };
  }
}

export async function getStorageHealth(env) {
  const snapshot = collectSnapshot(env);
  const hash = await hashSnapshot(snapshot);
  const kvKey = KV_PREFIX + hash;

  let cached;
  try {
    const raw = await env.img_url.get(kvKey);
    if (raw) {
      cached = JSON.parse(raw);
    }
  } catch {}

  if (cached) {
    return { hash, cached: true, results: cached.results, checkedAt: cached.checkedAt };
  }

  const types = Object.keys(ENV_VARS);
  const results = {};
  const allChecks = types.map(async (type) => {
    results[type] = await checkBackend(type, env);
  });
  await Promise.allSettled(allChecks);

  const payload = { hash, checkedAt: Date.now(), results };
  try {
    await env.img_url.put(kvKey, JSON.stringify(payload), { expirationTtl: 86400 });
  } catch {}

  return { hash, cached: false, results, checkedAt: payload.checkedAt };
}

export async function invalidateStorageHealth(env, type) {
  const snapshot = collectSnapshot(env);
  const hash = await hashSnapshot(snapshot);
  const kvKey = KV_PREFIX + hash;

  try {
    const raw = await env.img_url.get(kvKey);
    if (raw) {
      const cached = JSON.parse(raw);
      cached.results[type] = await checkBackend(type, env);
      cached.checkedAt = Date.now();
      await env.img_url.put(kvKey, JSON.stringify(cached), { expirationTtl: 86400 });
    }
  } catch {}
}

export async function getAvailableChannels(env) {
  const health = await getStorageHealth(env);
  const channels = [];
  for (const [type, status] of Object.entries(health.results)) {
    if (status.connected) {
      channels.push({ id: type, name: getDisplayName(type), default: type === 'telegram' });
    }
  }
  return channels;
}

function getDisplayName(type) {
  const names = {
    telegram: 'Telegram',
    r2: 'Cloudflare R2',
    s3: 'S3 兼容存储',
    discord: 'Discord',
    huggingface: 'HuggingFace',
    webdav: 'WebDAV',
    github: 'GitHub',
  };
  return names[type] || type;
}
