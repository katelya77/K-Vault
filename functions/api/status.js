import { createS3Client } from '../utils/s3client.js';
import { checkDiscordConnection } from '../utils/discord.js';
import { checkHuggingFaceConnection, hasHuggingFaceConfig } from '../utils/huggingface.js';
import { checkWebDAVConnection, hasWebDAVConfig } from '../utils/webdav.js';
import { checkGitHubConnection, hasGitHubConfig } from '../utils/github.js';
import { getGuestConfig } from '../utils/guest.js';
import { buildTelegramBotApiUrl, getTelegramApiBase } from '../utils/telegram.js';

function defaultStatusItem({ layer = 'direct' } = {}) {
  return {
    connected: false,
    enabled: false,
    configured: false,
    layer,
    message: 'Not configured',
  };
}

function storageCapability(type, label, layer = 'direct') {
  return {
    type,
    label,
    layer,
    enableHint: 'Configure this storage backend first.',
  };
}

export async function onRequestGet(context) {
  const { env } = context;

  const status = {
    telegram: defaultStatusItem({ layer: 'direct' }),
    kv: { connected: false, enabled: false, configured: false, layer: 'direct', message: 'Not configured' },
    r2: defaultStatusItem({ layer: 'direct' }),
    s3: defaultStatusItem({ layer: 'direct' }),
    discord: defaultStatusItem({ layer: 'direct' }),
    huggingface: defaultStatusItem({ layer: 'direct' }),
    webdav: defaultStatusItem({ layer: 'mounted' }),
    github: defaultStatusItem({ layer: 'direct' }),
    auth: { enabled: false, message: 'Disabled' },
    guestUpload: getGuestConfig(env),
    capabilities: [
      storageCapability('telegram', 'Telegram', 'direct'),
      storageCapability('r2', 'R2', 'direct'),
      storageCapability('s3', 'S3', 'direct'),
      storageCapability('discord', 'Discord', 'direct'),
      storageCapability('huggingface', 'HuggingFace', 'direct'),
      storageCapability('webdav', 'WebDAV', 'mounted'),
      storageCapability('github', 'GitHub', 'direct'),
    ],
  };

  const checks = [];

  if (env.TG_Bot_Token && env.TG_Chat_ID) {
    status.telegram.configured = true;
    checks.push(
      fetch(buildTelegramBotApiUrl(env, 'getMe'))
        .then((res) => res.json())
        .then((data) => {
          if (data?.ok) {
            status.telegram = {
              connected: true,
              enabled: true,
              configured: true,
              layer: 'direct',
              message: `Connected: @${data.result.username}`,
              botName: data.result.first_name,
              botUsername: data.result.username,
              apiBase: getTelegramApiBase(env),
            };
          } else {
            status.telegram = {
              connected: false,
              enabled: false,
              configured: true,
              layer: 'direct',
              message: data?.description || 'Telegram API check failed',
            };
          }
        })
        .catch((error) => {
          status.telegram = {
            connected: false,
            enabled: false,
            configured: true,
            layer: 'direct',
            message: error.message || 'Telegram API check failed',
          };
        })
    );
  }

  if (env.img_url) {
    status.kv.configured = true;
    checks.push(
      env.img_url.list({ limit: 1 })
        .then((result) => {
          status.kv = {
            connected: true,
            enabled: true,
            configured: true,
            layer: 'direct',
            message: 'Connected',
            hasData: Array.isArray(result?.keys) && result.keys.length > 0,
          };
        })
        .catch((error) => {
          status.kv = {
            connected: false,
            enabled: false,
            configured: true,
            layer: 'direct',
            message: error.message || 'KV check failed',
          };
        })
    );
  }

  if (env.R2_BUCKET) {
    status.r2.configured = true;
    checks.push(
      env.R2_BUCKET.list({ limit: 1 })
        .then((result) => {
          status.r2 = {
            connected: true,
            enabled: true,
            configured: true,
            layer: 'direct',
            message: 'Connected',
            hasData: Array.isArray(result?.objects) && result.objects.length > 0,
          };
        })
        .catch((error) => {
          status.r2 = {
            connected: false,
            enabled: false,
            configured: true,
            layer: 'direct',
            message: error.message || 'R2 check failed',
          };
        })
    );
  }

  if (env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_BUCKET) {
    status.s3.configured = true;
    checks.push(
      (async () => {
        try {
          const s3 = createS3Client(env);
          const connected = await s3.checkConnection();
          status.s3 = {
            connected,
            enabled: connected,
            configured: true,
            layer: 'direct',
            message: connected ? `Connected: ${env.S3_BUCKET}` : 'S3 check failed',
          };
        } catch (error) {
          status.s3 = {
            connected: false,
            enabled: false,
            configured: true,
            layer: 'direct',
            message: error.message || 'S3 check failed',
          };
        }
      })()
    );
  }

  if (env.DISCORD_WEBHOOK_URL || env.DISCORD_BOT_TOKEN) {
    status.discord.configured = true;
    checks.push(
      checkDiscordConnection(env)
        .then((result) => {
          status.discord = {
            connected: Boolean(result?.connected),
            enabled: Boolean(result?.connected),
            configured: true,
            layer: 'direct',
            message: result?.connected
              ? `Connected (${result.mode || 'unknown'})`
              : 'Discord check failed',
            mode: result?.mode,
          };
        })
        .catch((error) => {
          status.discord = {
            connected: false,
            enabled: false,
            configured: true,
            layer: 'direct',
            message: error.message || 'Discord check failed',
          };
        })
    );
  }

  if (hasHuggingFaceConfig(env)) {
    status.huggingface.configured = true;
    checks.push(
      checkHuggingFaceConnection(env)
        .then((result) => {
          status.huggingface = {
            connected: Boolean(result?.connected),
            enabled: Boolean(result?.connected),
            configured: true,
            layer: 'direct',
            message: result?.connected
              ? `Connected: ${result.repoId}${result.isPrivate ? ' (private)' : ''}`
              : (result?.error || 'HuggingFace check failed'),
          };
        })
        .catch((error) => {
          status.huggingface = {
            connected: false,
            enabled: false,
            configured: true,
            layer: 'direct',
            message: error.message || 'HuggingFace check failed',
          };
        })
    );
  }

  if (hasWebDAVConfig(env)) {
    status.webdav.configured = true;
    checks.push(
      checkWebDAVConnection(env)
        .then((result) => {
          status.webdav = {
            connected: Boolean(result?.connected),
            enabled: Boolean(result?.connected),
            configured: true,
            layer: 'mounted',
            message: result?.connected ? 'Connected' : (result?.message || 'WebDAV check failed'),
            detail: result?.detail,
            status: result?.status,
          };
        })
        .catch((error) => {
          status.webdav = {
            connected: false,
            enabled: false,
            configured: true,
            layer: 'mounted',
            message: error.message || 'WebDAV check failed',
          };
        })
    );
  }

  if (hasGitHubConfig(env)) {
    status.github.configured = true;
    checks.push(
      checkGitHubConnection(env)
        .then((result) => {
          status.github = {
            connected: Boolean(result?.connected),
            enabled: Boolean(result?.connected),
            configured: true,
            layer: 'direct',
            message: result?.connected ? 'Connected' : (result?.message || 'GitHub check failed'),
            mode: result?.mode,
            status: result?.status,
            detail: result?.detail,
          };
        })
        .catch((error) => {
          status.github = {
            connected: false,
            enabled: false,
            configured: true,
            layer: 'direct',
            message: error.message || 'GitHub check failed',
          };
        })
    );
  }

  await Promise.allSettled(checks);

  return new Response(JSON.stringify(status, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    },
  });
}
