/**
 * 数据库迁移脚本：从 KV 迁移到 D1/SQLite
 * 用于 Cloudflare Pages 和 Docker 部署
 * 
 * 用法：
 *   node scripts/migrate-kv-to-db.js [options]
 * 
 * 选项：
 *   --keep-kv       迁移后保留 KV 中的原数据
 *   --dry-run       仅模拟运行，不实际写入数据库
 *   --help          显示帮助信息
 */

const crypto = require('node:crypto');

function generateId() {
  return crypto.randomUUID();
}

function getTimestamp() {
  return Date.now();
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    keepKv: args.includes('--keep-kv'),
    dryRun: args.includes('--dry-run'),
    help: args.includes('--help')
  };
}

function showHelp() {
  console.log(`
KV 到数据库迁移脚本

用法：
  node scripts/migrate-kv-to-db.js [options]

选项：
  --keep-kv       迁移后保留 KV 中的原数据（默认删除）
  --dry-run       仅模拟运行，不实际写入数据库
  --help          显示帮助信息

示例：
  # 迁移并删除 KV 原数据
  node scripts/migrate-kv-to-db.js

  # 迁移但保留 KV 原数据
  node scripts/migrate-kv-to-db.js --keep-kv

  # 模拟迁移（不写入数据库）
  node scripts/migrate-kv-to-db.js --dry-run
`);
}

async function createFolder(db, name, parentId, path) {
  const id = generateId();
  const now = getTimestamp();
  
  await db.prepare(`
    INSERT INTO folders (id, name, parent_id, path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, name, parentId, path, now, now).run();
  
  return id;
}

async function migrateFilesFromKV(kv, db, options = {}) {
  console.log('开始迁移文件元数据...');
  
  let cursor = null;
  let totalMigrated = 0;
  let totalSkipped = 0;
  const errors = [];
  const migratedKeys = [];
  
  const rootFolderId = await createFolder(db, 'root', null, '/');
  console.log('创建根文件夹:', rootFolderId);
  
  do {
    const list = await kv.list({ cursor, prefix: '' });
    
    for (const key of list.keys) {
      try {
        if (key.name.startsWith('session:') || 
            key.name.startsWith('chunk:') || 
            key.name.startsWith('upload:') ||
            key.name.startsWith('paste:') ||
            key.name.startsWith('token:') ||
            key.name.startsWith('storage:') ||
            key.name.startsWith('guest:')) {
          totalSkipped++;
          continue;
        }
        
        const record = await kv.getWithMetadata(key.name);
        if (!record || !record.metadata) {
          totalSkipped++;
          continue;
        }
        
        const metadata = record.metadata;
        const fileId = generateId();
        const now = getTimestamp();
        
        if (!options.dryRun) {
          await db.prepare(`
            INSERT INTO files (
              id, storage_config_id, storage_type, storage_key, storage_file_id,
              file_name, file_size, mime_type, folder_id, folder_path,
              list_type, label, liked, extra_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            fileId,
            metadata.storageConfigId || 'default',
            metadata.storageType || 'telegram',
            key.name,
            metadata.storageFileId || null,
            metadata.fileName || key.name,
            metadata.fileSize || 0,
            metadata.mimeType || null,
            rootFolderId,
            metadata.folderPath || '',
            metadata.listType || 'None',
            metadata.label || 'None',
            metadata.liked ? 1 : 0,
            JSON.stringify(metadata.extra || {}),
            metadata.TimeStamp || now,
            now
          ).run();
        }
        
        migratedKeys.push(key.name);
        totalMigrated++;
        
        if (totalMigrated % 100 === 0) {
          console.log(`已迁移 ${totalMigrated} 个文件...`);
        }
      } catch (error) {
        errors.push({ key: key.name, error: error.message });
        console.error(`迁移文件失败: ${key.name}`, error);
      }
    }
    
    cursor = list.cursor;
  } while (cursor);
  
  console.log(`文件迁移完成: 成功 ${totalMigrated}, 跳过 ${totalSkipped}, 失败 ${errors.length}`);
  
  return {
    success: true,
    totalMigrated,
    totalSkipped,
    errors,
    migratedKeys
  };
}

async function migrateSharesFromKV(kv, db, options = {}) {
  console.log('开始迁移分享链接...');
  
  let cursor = null;
  let totalMigrated = 0;
  let totalSkipped = 0;
  const errors = [];
  const migratedKeys = [];
  
  do {
    const list = await kv.list({ cursor, prefix: 'paste:' });
    
    for (const key of list.keys) {
      try {
        const slug = key.name.replace('paste:', '');
        const record = await kv.get(key.name, { type: 'json' });
        
        if (!record) {
          totalSkipped++;
          continue;
        }
        
        const fileRecord = await db.prepare(`
          SELECT id FROM files WHERE storage_key = ? LIMIT 1
        `).bind(record.fileId).first();
        
        if (!fileRecord) {
          console.warn(`找不到对应的文件: ${record.fileId}`);
          totalSkipped++;
          continue;
        }
        
        const shareId = generateId();
        const now = getTimestamp();
        
        if (!options.dryRun) {
          await db.prepare(`
            INSERT INTO shares (
              id, slug, file_id, password_hash, expires_at,
              max_downloads, download_count, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            shareId,
            slug,
            fileRecord.id,
            record.passwordHash || null,
            record.expiresAt || null,
            record.maxDownloads || 0,
            record.downloadCount || 0,
            record.createdAt || now
          ).run();
        }
        
        migratedKeys.push(key.name);
        totalMigrated++;
      } catch (error) {
        errors.push({ key: key.name, error: error.message });
        console.error(`迁移分享链接失败: ${key.name}`, error);
      }
    }
    
    cursor = list.cursor;
  } while (cursor);
  
  console.log(`分享链接迁移完成: 成功 ${totalMigrated}, 跳过 ${totalSkipped}, 失败 ${errors.length}`);
  
  return {
    success: true,
    totalMigrated,
    totalSkipped,
    errors,
    migratedKeys
  };
}

async function migrateTokensFromKV(kv, db, options = {}) {
  console.log('开始迁移 API Token...');
  
  let cursor = null;
  let totalMigrated = 0;
  const errors = [];
  const migratedKeys = [];
  
  do {
    const list = await kv.list({ cursor, prefix: 'token:' });
    
    for (const key of list.keys) {
      try {
        const tokenId = key.name.replace('token:', '');
        const record = await kv.get(key.name, { type: 'json' });
        
        if (!record) continue;
        
        const now = getTimestamp();
        
        if (!options.dryRun) {
          await db.prepare(`
            INSERT INTO api_tokens (
              id, name, token_hash, created_at, last_used_at, enabled
            ) VALUES (?, ?, ?, ?, ?, ?)
          `).bind(
            tokenId,
            record.name || 'Unnamed Token',
            record.tokenHash || crypto.createHash('sha256').update(record.token).digest('hex'),
            record.createdAt || now,
            record.lastUsedAt || null,
            record.enabled !== false ? 1 : 0
          ).run();
        }
        
        migratedKeys.push(key.name);
        totalMigrated++;
      } catch (error) {
        errors.push({ key: key.name, error: error.message });
        console.error(`迁移 Token 失败: ${key.name}`, error);
      }
    }
    
    cursor = list.cursor;
  } while (cursor);
  
  console.log(`API Token 迁移完成: 成功 ${totalMigrated}, 失败 ${errors.length}`);
  
  return {
    success: true,
    totalMigrated,
    errors,
    migratedKeys
  };
}

async function migrateStorageConfigsFromKV(kv, db, options = {}) {
  console.log('开始迁移存储配置...');
  
  let cursor = null;
  let totalMigrated = 0;
  const errors = [];
  const migratedKeys = [];
  
  do {
    const list = await kv.list({ cursor, prefix: 'storage:' });
    
    for (const key of list.keys) {
      try {
        const configId = key.name.replace('storage:', '');
        const record = await kv.get(key.name, { type: 'json' });
        
        if (!record) continue;
        
        const now = getTimestamp();
        
        if (!options.dryRun) {
          await db.prepare(`
            INSERT INTO storage_configs (
              id, name, type, encrypted_payload, is_default, enabled,
              metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            configId,
            record.name || 'Unnamed Storage',
            record.type || 'telegram',
            record.encryptedPayload || JSON.stringify(record.config),
            record.isDefault ? 1 : 0,
            record.enabled !== false ? 1 : 0,
            JSON.stringify(record.metadata || {}),
            record.createdAt || now,
            record.updatedAt || now
          ).run();
        }
        
        migratedKeys.push(key.name);
        totalMigrated++;
      } catch (error) {
        errors.push({ key: key.name, error: error.message });
        console.error(`迁移存储配置失败: ${key.name}`, error);
      }
    }
    
    cursor = list.cursor;
  } while (cursor);
  
  console.log(`存储配置迁移完成: 成功 ${totalMigrated}, 失败 ${errors.length}`);
  
  return {
    success: true,
    totalMigrated,
    errors,
    migratedKeys
  };
}

async function deleteMigratedKeys(kv, allMigratedKeys) {
  console.log(`开始删除 KV 中已迁移的数据 (${allMigratedKeys.length} 个键)...`);
  
  let deleted = 0;
  for (const key of allMigratedKeys) {
    try {
      await kv.delete(key);
      deleted++;
      if (deleted % 100 === 0) {
        console.log(`已删除 ${deleted} 个键...`);
      }
    } catch (error) {
      console.error(`删除键失败: ${key}`, error);
    }
  }
  
  console.log(`KV 数据清理完成: 删除 ${deleted} 个键`);
  return deleted;
}

async function runMigration(kv, db, options = {}) {
  if (options.help) {
    showHelp();
    return { success: true };
  }
  
  console.log('========================================');
  console.log('开始数据库迁移');
  console.log('========================================');
  console.log(`选项: keepKv=${options.keepKv}, dryRun=${options.dryRun}`);
  
  const results = {
    files: null,
    shares: null,
    tokens: null,
    storageConfigs: null,
    kvCleanup: null
  };
  
  try {
    results.files = await migrateFilesFromKV(kv, db, options);
    results.shares = await migrateSharesFromKV(kv, db, options);
    results.tokens = await migrateTokensFromKV(kv, db, options);
    results.storageConfigs = await migrateStorageConfigsFromKV(kv, db, options);
    
    if (!options.keepKv && !options.dryRun) {
      const allMigratedKeys = [
        ...(results.files.migratedKeys || []),
        ...(results.shares.migratedKeys || []),
        ...(results.tokens.migratedKeys || []),
        ...(results.storageConfigs.migratedKeys || [])
      ];
      
      results.kvCleanup = await deleteMigratedKeys(kv, allMigratedKeys);
    }
    
    console.log('========================================');
    console.log('数据库迁移完成');
    console.log('========================================');
    
    return {
      success: true,
      results
    };
  } catch (error) {
    console.error('迁移失败:', error);
    return {
      success: false,
      error: error.message,
      results
    };
  }
}

module.exports = {
  runMigration,
  migrateFilesFromKV,
  migrateSharesFromKV,
  migrateTokensFromKV,
  migrateStorageConfigsFromKV,
  deleteMigratedKeys,
  parseArgs,
  showHelp
};
