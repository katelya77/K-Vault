import { requireJwtAuth, createJwtAuthResponse } from '../../../utils/jwt-auth.js';
import { ensureTablesExist } from '../../../utils/migrations.js';

function generateId() {
  return crypto.randomUUID();
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequestGet(context) {
  const { env } = context;

  const authResult = await requireJwtAuth(context.request, env);
  if (!authResult.authorized) {
    return createJwtAuthResponse(authResult.error, authResult.statusCode);
  }

  if (!env.DB) {
    return jsonResponse({ success: false, error: 'D1 database not configured' }, 500);
  }
  if (!env.img_url) {
    return jsonResponse({ success: false, error: 'KV binding img_url not configured' }, 500);
  }

  const url = new URL(context.request.url);
  const action = url.searchParams.get('action');
  const keepKV = url.searchParams.get('keepKV') === 'true';

  if (action === 'migrate') {
    return await migrateKvToD1(env, keepKV);
  }

  return await getKvStats(env);
}

async function getKvStats(env) {
  try {
    const prefixGroups = [
      { prefix: 'img:', label: '图片文件' },
      { prefix: 'vid:', label: '视频文件' },
      { prefix: 'aud:', label: '音频文件' },
      { prefix: 'doc:', label: '文档文件' },
      { prefix: 'r2:', label: 'R2 文件' },
      { prefix: 's3:', label: 'S3 文件' },
      { prefix: 'discord:', label: 'Discord 文件' },
      { prefix: 'hf:', label: 'HuggingFace 文件' },
      { prefix: 'webdav:', label: 'WebDAV 文件' },
      { prefix: 'github:', label: 'GitHub 文件' },
      { prefix: '', label: '无前缀文件' },
      { prefix: 'paste:', label: '分享链接' },
      { prefix: 'token:', label: 'API Token' },
      { prefix: 'storage:', label: '存储配置' },
    ];

    const stats = [];
    for (const group of prefixGroups) {
      const list = await env.img_url.list({ prefix: group.prefix, limit: 1 });
      if (list.keys.length > 0 || group.prefix === '') {
        const fullList = await env.img_url.list({ prefix: group.prefix });
        stats.push({
          prefix: group.prefix || '(无前缀)',
          label: group.label,
          count: fullList.keys.length
        });
      }
    }

    const fileCount = await env.DB.prepare('SELECT COUNT(*) as count FROM files').first();
    const shareCount = await env.DB.prepare('SELECT COUNT(*) as count FROM shares').first();
    const tokenCount = await env.DB.prepare('SELECT COUNT(*) as count FROM api_tokens').first();
    const configCount = await env.DB.prepare('SELECT COUNT(*) as count FROM storage_configs').first();

    return jsonResponse({
      success: true,
      kv_stats: stats,
      d1_stats: {
        files: fileCount?.count || 0,
        shares: shareCount?.count || 0,
        tokens: tokenCount?.count || 0,
        storage_configs: configCount?.count || 0,
      }
    });
  } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 500);
  }
}

async function migrateKvToD1(env, keepKV) {
  try {
    await ensureTablesExist(env.DB);

    const result = {
      files: { migrated: 0, skipped: 0, errors: [] },
      shares: { migrated: 0, skipped: 0, errors: [] },
      tokens: { migrated: 0, errors: [] },
      storage_configs: { migrated: 0, errors: [] },
    };

    const filePrefixes = ['img:', 'vid:', 'aud:', 'doc:', 'r2:', 's3:', 'discord:', 'hf:', 'webdav:', 'github:', ''];

    let rootFolderId = null;
    const existingRoot = await env.DB.prepare("SELECT id FROM folders WHERE path = '/' LIMIT 1").first();
    if (existingRoot) {
      rootFolderId = existingRoot.id;
    } else {
      rootFolderId = generateId();
      const now = Date.now();
      await env.DB.prepare(
        'INSERT INTO folders (id, name, parent_id, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(rootFolderId, 'root', null, '/', now, now).run();
    }

    for (const prefix of filePrefixes) {
      let cursor = null;
      do {
        const list = await env.img_url.list({ cursor, prefix, limit: 1000 });
        for (const key of list.keys) {
          try {
            const record = await env.img_url.getWithMetadata(key.name);
            if (!record || !record.metadata) {
              result.files.skipped++;
              continue;
            }
            const meta = record.metadata;
            const existingFile = await env.DB.prepare(
              "SELECT id FROM files WHERE storage_key = ? LIMIT 1"
            ).bind(key.name).first();
            if (existingFile) {
              result.files.skipped++;
              continue;
            }
            const fileId = generateId();
            const now = Date.now();
            await env.DB.prepare(`
              INSERT INTO files (
                id, storage_config_id, storage_type, storage_key, storage_file_id,
                file_name, physical_file_name, file_size, mime_type, folder_id, folder_path,
                list_type, label, liked, extra_json, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              fileId,
              meta.storageConfigId || 'default',
              meta.storageType || meta.storage || 'telegram',
              key.name,
              meta.storageFileId || null,
              meta.fileName || key.name,
              meta.physicalFileName || null,
              meta.fileSize || 0,
              meta.mimeType || null,
              rootFolderId,
              meta.folderPath || '',
              meta.ListType || 'None',
              meta.Label || 'None',
              meta.liked ? 1 : 0,
              JSON.stringify(meta.extra || {}),
              meta.TimeStamp || now,
              now
            ).run();
            result.files.migrated++;
          } catch (err) {
            result.files.errors.push({ key: key.name, error: err.message });
          }
        }
        cursor = list.cursor;
      } while (cursor);
    }

    let cursor = null;
    do {
      const list = await env.img_url.list({ cursor, prefix: 'paste:', limit: 1000 });
      for (const key of list.keys) {
        try {
          const slug = key.name.replace('paste:', '');
          const record = await env.img_url.get(key.name, { type: 'json' });
          if (!record) { result.shares.skipped++; continue; }

          const fileRecord = await env.DB.prepare(
            "SELECT id FROM files WHERE storage_key = ? LIMIT 1"
          ).bind(record.fileId).first();
          if (!fileRecord) { result.shares.skipped++; continue; }

          const existingShare = await env.DB.prepare(
            "SELECT id FROM shares WHERE slug = ? LIMIT 1"
          ).bind(slug).first();
          if (existingShare) { result.shares.skipped++; continue; }

          const shareId = generateId();
          const now = Date.now();
          await env.DB.prepare(`
            INSERT INTO shares (id, slug, file_id, password_hash, expires_at, max_downloads, download_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            shareId, slug, fileRecord.id,
            record.passwordHash || null, record.expiresAt || null,
            record.maxDownloads || 0, record.downloadCount || 0,
            record.createdAt || now
          ).run();
          result.shares.migrated++;
        } catch (err) {
          result.shares.errors.push({ key: key.name, error: err.message });
        }
      }
      cursor = list.cursor;
    } while (cursor);

    cursor = null;
    do {
      const list = await env.img_url.list({ cursor, prefix: 'token:', limit: 1000 });
      for (const key of list.keys) {
        try {
          const tokenId = key.name.replace('token:', '');
          const record = await env.img_url.get(key.name, { type: 'json' });
          if (!record) continue;

          const existingToken = await env.DB.prepare(
            "SELECT id FROM api_tokens WHERE id = ? LIMIT 1"
          ).bind(tokenId).first();
          if (existingToken) continue;

          const now = Date.now();
          await env.DB.prepare(`
            INSERT INTO api_tokens (id, name, token_hash, created_at, last_used_at, enabled)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(
            tokenId,
            record.name || 'Unnamed Token',
            record.tokenHash || '',
            record.createdAt || now,
            record.lastUsedAt || null,
            record.enabled !== false ? 1 : 0
          ).run();
          result.tokens.migrated++;
        } catch (err) {
          result.tokens.errors.push({ key: key.name, error: err.message });
        }
      }
      cursor = list.cursor;
    } while (cursor);

    cursor = null;
    do {
      const list = await env.img_url.list({ cursor, prefix: 'storage:', limit: 1000 });
      for (const key of list.keys) {
        try {
          const configId = key.name.replace('storage:', '');
          const record = await env.img_url.get(key.name, { type: 'json' });
          if (!record) continue;

          const existingConfig = await env.DB.prepare(
            "SELECT id FROM storage_configs WHERE id = ? LIMIT 1"
          ).bind(configId).first();
          if (existingConfig) continue;

          const now = Date.now();
          await env.DB.prepare(`
            INSERT INTO storage_configs (id, name, type, encrypted_payload, is_default, enabled, metadata_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            configId,
            record.name || 'Unnamed Storage',
            record.type || 'telegram',
            record.encryptedPayload || JSON.stringify(record.config || {}),
            record.isDefault ? 1 : 0,
            record.enabled !== false ? 1 : 0,
            JSON.stringify(record.metadata || {}),
            record.createdAt || now,
            record.updatedAt || now
          ).run();
          result.storage_configs.migrated++;
        } catch (err) {
          result.storage_configs.errors.push({ key: key.name, error: err.message });
        }
      }
      cursor = list.cursor;
    } while (cursor);

    if (!keepKV) {
      const allMigratedKeys = [];
      for (const prefix of [...filePrefixes, 'paste:', 'token:', 'storage:']) {
        let c = null;
        do {
          const l = await env.img_url.list({ cursor: c, prefix, limit: 1000 });
          for (const k of l.keys) {
            allMigratedKeys.push(k.name);
          }
          c = l.cursor;
        } while (c);
      }
      let deleted = 0;
      for (const key of allMigratedKeys) {
        await env.img_url.delete(key);
        deleted++;
      }
      result.cleaned_kv = deleted;
    }

    return jsonResponse({
      success: true,
      message: 'KV to D1 migration completed',
      keepKV: !!keepKV,
      result
    });
  } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 500);
  }
}
