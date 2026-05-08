#!/usr/bin/env node

/**
 * Docker SQLite 数据迁移脚本
 * 从 KV 数据迁移到 SQLite 数据库
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || './data/kvault.db';
const BATCH_SIZE = 100;

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function error(message) {
  console.error(`[${new Date().toISOString()}] ERROR: ${message}`);
}

function generateId() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let output = '';
  for (let i = 0; i < 16; i += 1) {
    output += chars[bytes[i] % chars.length];
  }
  return output;
}

async function migrateFiles(db, kvData) {
  log('开始迁移文件元数据...');
  
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO files (
      id, storage_config_id, storage_type, storage_key, storage_file_id,
      file_name, file_size, mime_type, folder_id, folder_path,
      list_type, label, liked, extra_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  for (const [key, metadata] of Object.entries(kvData.files || {})) {
    try {
      const id = generateId();
      const storageType = inferStorageType(key, metadata);
      const fileName = metadata.fileName || key;
      const fileSize = metadata.fileSize || 0;
      const mimeType = metadata.mimeType || 'application/octet-stream';
      const folderPath = metadata.folderPath || '';
      const createdAt = metadata.TimeStamp || Date.now();
      
      stmt.run(
        id,
        'default',
        storageType,
        key,
        metadata.telegramFileId || null,
        fileName,
        fileSize,
        mimeType,
        null,
        folderPath,
        metadata.ListType || 'None',
        metadata.Label || 'None',
        metadata.liked ? 1 : 0,
        JSON.stringify({}),
        createdAt,
        createdAt
      );
      
      count += 1;
      if (count % BATCH_SIZE === 0) {
        log(`已迁移 ${count} 个文件...`);
      }
    } catch (err) {
      error(`迁移文件失败: ${key} - ${err.message}`);
    }
  }
  
  log(`文件迁移完成，共迁移 ${count} 个文件`);
  return count;
}

async function migrateStorageConfigs(db, kvData) {
  log('开始迁移存储配置...');
  
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO storage_configs (
      id, name, type, encrypted_payload, is_default, enabled, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  for (const [id, config] of Object.entries(kvData.storageConfigs || {})) {
    try {
      const now = Date.now();
      stmt.run(
        id,
        config.name || 'Unknown',
        config.type || 'telegram',
        config.encryptedPayload || '',
        config.isDefault ? 1 : 0,
        config.enabled ? 1 : 0,
        JSON.stringify(config.metadata || {}),
        now,
        now
      );
      count += 1;
    } catch (err) {
      error(`迁移存储配置失败: ${id} - ${err.message}`);
    }
  }
  
  log(`存储配置迁移完成，共迁移 ${count} 个配置`);
  return count;
}

function inferStorageType(key, metadata) {
  if (metadata.storageType) return metadata.storageType;
  if (key.startsWith('r2:')) return 'r2';
  if (key.startsWith('s3:')) return 's3';
  if (key.startsWith('discord:')) return 'discord';
  if (key.startsWith('hf:')) return 'huggingface';
  if (key.startsWith('webdav:')) return 'webdav';
  if (key.startsWith('github:')) return 'github';
  return 'telegram';
}

async function runMigration() {
  log('========================================');
  log('Docker SQLite 数据迁移');
  log('========================================');
  
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    log(`创建数据库目录: ${dbDir}`);
  }
  
  const db = new DatabaseSync(DB_PATH);
  
  const schemaPath = path.resolve(__dirname, '../server/db/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
  log('数据库表结构初始化完成');
  
  const kvDataPath = process.env.KV_DATA_PATH || './data/kv-backup.json';
  if (!fs.existsSync(kvDataPath)) {
    log(`KV 数据文件不存在: ${kvDataPath}`);
    log('跳过数据迁移，使用空数据库');
    db.close();
    return;
  }
  
  log(`读取 KV 数据文件: ${kvDataPath}`);
  const kvData = JSON.parse(fs.readFileSync(kvDataPath, 'utf8'));
  
  const results = {
    files: 0,
    storageConfigs: 0
  };
  
  try {
    db.exec('BEGIN TRANSACTION');
    
    results.files = await migrateFiles(db, kvData);
    results.storageConfigs = await migrateStorageConfigs(db, kvData);
    
    db.exec('COMMIT');
    
    log('========================================');
    log('迁移完成');
    log('========================================');
    log(`文件: ${results.files}`);
    log(`存储配置: ${results.storageConfigs}`);
    
  } catch (err) {
    db.exec('ROLLBACK');
    error(`迁移失败: ${err.message}`);
    throw err;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  runMigration().catch(err => {
    error(err.message);
    process.exit(1);
  });
}

module.exports = { runMigration };
