/**
 * 数据库迁移脚本：从 KV 迁移到 D1/SQLite
 * 用于 Cloudflare Pages 和 Docker 部署
 */

const crypto = require('node:crypto');

function generateId() {
  return crypto.randomUUID();
}

function getTimestamp() {
  return Date.now();
}

/**
 * 创建文件夹
 */
async function createFolder(db, name, parentId, path) {
  const id = generateId();
  const now = getTimestamp();
  
  await db.prepare(`
    INSERT INTO folders (id, name, parent_id, path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, name, parentId, path, now, now).run();
  
  return id;
}

/**
 * 从 KV 迁移文件元数据到数据库
 */
async function migrateFilesFromKV(kv, db, progressCallback = () => {}) {
  console.log('开始迁移文件元数据...');
  
  let cursor = null;
  let totalMigrated = 0;
  let totalSkipped = 0;
  const errors = [];
  
  // 创建根文件夹
  const rootFolderId = await createFolder(db, 'root', null, '/');
  console.log('创建根文件夹:', rootFolderId);
  
  // 遍历 KV 中的所有键
  do {
    const list = await kv.list({ cursor, prefix: '' });
    
    for (const key of list.keys) {
      try {
        // 跳过非文件键
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
        
        // 获取文件元数据
        const record = await kv.getWithMetadata(key.name);
        if (!record || !record.metadata) {
          totalSkipped++;
          continue;
        }
        
        const metadata = record.metadata;
        
        // 插入文件记录
        const fileId = generateId();
        const now = getTimestamp();
        
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
        
        totalMigrated++;
        
        if (totalMigrated % 100 === 0) {
          progressCallback({ totalMigrated, totalSkipped });
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
    errors
  };
}

/**
 * 从 KV 迁移分享链接到数据库
 */
async function migrateSharesFromKV(kv, db, progressCallback = () => {}) {
  console.log('开始迁移分享链接...');
  
  let cursor = null;
  let totalMigrated = 0;
  let totalSkipped = 0;
  const errors = [];
  
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
        
        // 查找对应的文件 ID
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
    errors
  };
}

/**
 * 从 KV 迁移 API Token 到数据库
 */
async function migrateTokensFromKV(kv, db, progressCallback = () => {}) {
  console.log('开始迁移 API Token...');
  
  let cursor = null;
  let totalMigrated = 0;
  const errors = [];
  
  do {
    const list = await kv.list({ cursor, prefix: 'token:' });
    
    for (const key of list.keys) {
      try {
        const tokenId = key.name.replace('token:', '');
        const record = await kv.get(key.name, { type: 'json' });
        
        if (!record) continue;
        
        const now = getTimestamp();
        
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
    errors
  };
}

/**
 * 从 KV 迁移存储配置到数据库
 */
async function migrateStorageConfigsFromKV(kv, db, progressCallback = () => {}) {
  console.log('开始迁移存储配置...');
  
  let cursor = null;
  let totalMigrated = 0;
  const errors = [];
  
  do {
    const list = await kv.list({ cursor, prefix: 'storage:' });
    
    for (const key of list.keys) {
      try {
        const configId = key.name.replace('storage:', '');
        const record = await kv.get(key.name, { type: 'json' });
        
        if (!record) continue;
        
        const now = getTimestamp();
        
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
    errors
  };
}

/**
 * 执行完整迁移
 */
async function runMigration(kv, db, options = {}) {
  console.log('========================================');
  console.log('开始数据库迁移');
  console.log('========================================');
  
  const results = {
    files: null,
    shares: null,
    tokens: null,
    storageConfigs: null
  };
  
  try {
    // 迁移文件
    if (options.migrateFiles !== false) {
      results.files = await migrateFilesFromKV(kv, db);
    }
    
    // 迁移分享链接
    if (options.migrateShares !== false) {
      results.shares = await migrateSharesFromKV(kv, db);
    }
    
    // 迁移 API Token
    if (options.migrateTokens !== false) {
      results.tokens = await migrateTokensFromKV(kv, db);
    }
    
    // 迁移存储配置
    if (options.migrateStorageConfigs !== false) {
      results.storageConfigs = await migrateStorageConfigsFromKV(kv, db);
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
  migrateStorageConfigsFromKV
};
