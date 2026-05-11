const path = require('node:path');

function toBool(value, defaultValue = false) {
  if (value == null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return defaultValue;
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveDataPath(...parts) {
  return path.resolve(process.cwd(), ...parts);
}

function stripWrappingQuotes(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  if (
    (text.startsWith('"') && text.endsWith('"'))
    || (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function normalizeEnvString(value, fallback = '') {
  const normalized = stripWrappingQuotes(value);
  return normalized || fallback;
}

function pickEnvAlias(env, aliases = [], fallback = '') {
  for (const alias of aliases) {
    const value = env[alias];
    const normalized = normalizeEnvString(value);
    if (normalized) {
      return { value: normalized, source: alias };
    }
  }
  return { value: normalizeEnvString(fallback), source: '' };
}

function loadConfig(env = process.env) {
  const dataDir = env.DATA_DIR
    ? path.resolve(normalizeEnvString(env.DATA_DIR))
    : resolveDataPath('data');
  const telegramToken = pickEnvAlias(env, ['TG_BOT_TOKEN', 'TG_Bot_Token']);
  const telegramChatId = pickEnvAlias(env, ['TG_CHAT_ID', 'TG_Chat_ID']);
  const telegramApiBase = pickEnvAlias(env, ['CUSTOM_BOT_API_URL'], 'https://api.telegram.org');
  const huggingFaceToken = pickEnvAlias(env, ['HF_TOKEN', 'HUGGINGFACE_TOKEN', 'HF_API_TOKEN']);
  const huggingFaceRepo = pickEnvAlias(env, ['HF_REPO', 'HUGGINGFACE_REPO', 'HF_DATASET_REPO']);
  const githubToken = pickEnvAlias(env, ['GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_PAT']);
  const githubRepo = pickEnvAlias(env, ['GITHUB_REPO', 'GH_REPO', 'GITHUB_REPOSITORY']);

  return {
    port: toInt(env.PORT, 8787),
    nodeEnv: normalizeEnvString(env.NODE_ENV, 'development'),
    publicBaseUrl: normalizeEnvString(env.PUBLIC_BASE_URL),

    basicUser: normalizeEnvString(''),
    basicPass: normalizeEnvString(''),
    sessionCookieName: normalizeEnvString(env.SESSION_COOKIE_NAME, 'k_vault_session'),
    sessionDurationMs: toInt(env.SESSION_DURATION_MS, 24 * 60 * 60 * 1000),

    guestUploadEnabled: toBool(env.GUEST_UPLOAD, false),
    guestMaxFileSize: toInt(env.GUEST_MAX_FILE_SIZE, 5 * 1024 * 1024),
    guestDailyLimit: toInt(env.GUEST_DAILY_LIMIT, 10),

    uploadMaxSize: toInt(env.UPLOAD_MAX_SIZE, 100 * 1024 * 1024),
    uploadSmallFileThreshold: toInt(env.UPLOAD_SMALL_FILE_THRESHOLD, 20 * 1024 * 1024),
    chunkSize: toInt(env.CHUNK_SIZE, 5 * 1024 * 1024),

    configEncryptionKey: normalizeEnvString(env.CONFIG_ENCRYPTION_KEY) || normalizeEnvString(env.FILE_URL_SECRET) || normalizeEnvString(env.SESSION_SECRET) || '',
    sessionSecret: normalizeEnvString(env.SESSION_SECRET) || normalizeEnvString(env.FILE_URL_SECRET) || normalizeEnvString(env.CONFIG_ENCRYPTION_KEY) || '',

    dataDir,
    dbPath: env.DB_PATH ? path.resolve(normalizeEnvString(env.DB_PATH)) : path.join(dataDir, 'k-vault.db'),
    chunkDir: env.CHUNK_DIR ? path.resolve(normalizeEnvString(env.CHUNK_DIR)) : path.join(dataDir, 'chunks'),
    settingsStore: normalizeEnvString(env.SETTINGS_STORE, 'sqlite').toLowerCase(),
    settingsRedisUrl: normalizeEnvString(env.SETTINGS_REDIS_URL) || normalizeEnvString(env.REDIS_URL) || '',
    settingsRedisPrefix: normalizeEnvString(env.SETTINGS_REDIS_PREFIX, 'k-vault'),
    settingsRedisConnectTimeoutMs: toInt(env.SETTINGS_REDIS_CONNECT_TIMEOUT_MS, 5000),

    telegramApiBase: telegramApiBase.value,

    // Optional bootstrap default storage from env.
    bootstrapDefaultStorage: {
      type: (env.DEFAULT_STORAGE_TYPE || 'telegram').toLowerCase(),
      telegram: {
        botToken: telegramToken.value || '',
        chatId: telegramChatId.value || '',
        apiBase: telegramApiBase.value || 'https://api.telegram.org',
        envSource: {
          botToken: telegramToken.source || 'none',
          chatId: telegramChatId.source || 'none',
          apiBase: telegramApiBase.source || 'default',
        },
      },
      r2: {
        endpoint: normalizeEnvString(env.R2_ENDPOINT) || normalizeEnvString(env.S3_ENDPOINT) || '',
        region: normalizeEnvString(env.R2_REGION) || normalizeEnvString(env.S3_REGION) || 'auto',
        bucket: normalizeEnvString(env.R2_BUCKET) || normalizeEnvString(env.S3_BUCKET) || '',
        accessKeyId: normalizeEnvString(env.R2_ACCESS_KEY_ID) || normalizeEnvString(env.S3_ACCESS_KEY_ID) || '',
        secretAccessKey: normalizeEnvString(env.R2_SECRET_ACCESS_KEY) || normalizeEnvString(env.S3_SECRET_ACCESS_KEY) || '',
      },
      s3: {
        endpoint: normalizeEnvString(env.S3_ENDPOINT),
        region: normalizeEnvString(env.S3_REGION, 'us-east-1'),
        bucket: normalizeEnvString(env.S3_BUCKET),
        accessKeyId: normalizeEnvString(env.S3_ACCESS_KEY_ID),
        secretAccessKey: normalizeEnvString(env.S3_SECRET_ACCESS_KEY),
      },
      discord: {
        webhookUrl: normalizeEnvString(env.DISCORD_WEBHOOK_URL),
        botToken: normalizeEnvString(env.DISCORD_BOT_TOKEN),
        channelId: normalizeEnvString(env.DISCORD_CHANNEL_ID),
      },
      huggingface: {
        token: huggingFaceToken.value || '',
        repo: huggingFaceRepo.value || '',
        envSource: {
          token: huggingFaceToken.source || 'none',
          repo: huggingFaceRepo.source || 'none',
        },
      },
      webdav: {
        baseUrl: normalizeEnvString(env.WEBDAV_BASE_URL),
        username: normalizeEnvString(env.WEBDAV_USERNAME),
        password: normalizeEnvString(env.WEBDAV_PASSWORD),
        bearerToken: normalizeEnvString(env.WEBDAV_BEARER_TOKEN) || normalizeEnvString(env.WEBDAV_TOKEN) || '',
        rootPath: normalizeEnvString(env.WEBDAV_ROOT_PATH),
      },
      github: {
        repo: githubRepo.value || '',
        token: githubToken.value || '',
        mode: normalizeEnvString(env.GITHUB_MODE, 'releases').toLowerCase(),
        prefix: normalizeEnvString(env.GITHUB_PREFIX) || normalizeEnvString(env.GITHUB_PATH) || '',
        releaseTag: normalizeEnvString(env.GITHUB_RELEASE_TAG),
        branch: normalizeEnvString(env.GITHUB_BRANCH),
        apiBase: normalizeEnvString(env.GITHUB_API_BASE, 'https://api.github.com'),
        envSource: {
          repo: githubRepo.source || 'none',
          token: githubToken.source || 'none',
        },
      },
    },
  };
}

module.exports = {
  loadConfig,
  toBool,
  toInt,
};
