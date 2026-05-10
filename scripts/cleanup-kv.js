/**
 * 清理 KV 中多余数据的脚本
 * 用于删除已迁移到数据库的数据或过期的临时数据
 * 
 * 用法：
 *   node scripts/cleanup-kv.js [options]
 * 
 * 选项：
 *   --migrated      删除已迁移到数据库的数据（文件元数据、分享链接、Token、存储配置）
 *   --expired       删除过期的临时数据（会话、分片上传）
 *   --all           删除所有可清理的数据
 *   --dry-run       仅模拟运行，不实际删除
 *   --prefix=xxx    删除指定前缀的键
 *   --help          显示帮助信息
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    migrated: args.includes('--migrated'),
    expired: args.includes('--expired'),
    all: args.includes('--all'),
    dryRun: args.includes('--dry-run'),
    help: args.includes('--help'),
    prefix: null
  };
  
  for (const arg of args) {
    if (arg.startsWith('--prefix=')) {
      options.prefix = arg.split('=')[1];
    }
  }
  
  return options;
}

function showHelp() {
  console.log(`
KV 数据清理脚本

用法：
  node scripts/cleanup-kv.js [options]

选项：
  --migrated      删除已迁移到数据库的数据
                  （文件元数据、分享链接、Token、存储配置）
  --expired       删除过期的临时数据
                  （会话、分片上传、访客计数）
  --all           删除所有可清理的数据
  --dry-run       仅模拟运行，不实际删除
  --prefix=xxx    删除指定前缀的键（例如 --prefix=session:）
  --help          显示帮助信息

示例：
  # 删除已迁移的数据
  node scripts/cleanup-kv.js --migrated

  # 删除过期数据
  node scripts/cleanup-kv.js --expired

  # 删除所有可清理的数据
  node scripts/cleanup-kv.js --all

  # 删除指定前缀的键
  node scripts/cleanup-kv.js --prefix=session:

  # 模拟运行（不实际删除）
  node scripts/cleanup-kv.js --migrated --dry-run
`);
}

const MIGRATED_PREFIXES = [
  '',           // 文件元数据（无前缀，需要排除其他前缀）
];

const MIGRATED_EXCLUDE_PREFIXES = [
  'session:',
  'chunk:',
  'upload:',
  'paste:',
  'token:',
  'storage:',
  'guest:',
];

const EXPIRED_PREFIXES = [
  'session:',
  'chunk:',
  'upload:',
  'guest:',
];

async function listAllKeys(kv, prefix = '') {
  const keys = [];
  let cursor = null;
  
  do {
    const list = await kv.list({ cursor, prefix });
    keys.push(...list.keys.map(k => k.name));
    cursor = list.cursor;
  } while (cursor);
  
  return keys;
}

async function deleteKeys(kv, keys, dryRun = false) {
  let deleted = 0;
  const errors = [];
  
  for (const key of keys) {
    try {
      if (!dryRun) {
        await kv.delete(key);
      }
      deleted++;
      if (deleted % 100 === 0) {
        console.log(`已处理 ${deleted} 个键...`);
      }
    } catch (error) {
      errors.push({ key, error: error.message });
      console.error(`删除失败: ${key}`, error);
    }
  }
  
  return { deleted, errors };
}

async function cleanupMigrated(kv, dryRun = false) {
  console.log('清理已迁移的数据...');
  
  const keysToDelete = [];
  
  const allKeys = await listAllKeys(kv, '');
  
  for (const key of allKeys) {
    const isExcluded = MIGRATED_EXCLUDE_PREFIXES.some(p => key.startsWith(p));
    if (!isExcluded) {
      const record = await kv.getWithMetadata(key);
      if (record && record.metadata) {
        keysToDelete.push(key);
      }
    }
  }
  
  for (const prefix of ['paste:', 'token:', 'storage:']) {
    const keys = await listAllKeys(kv, prefix);
    keysToDelete.push(...keys);
  }
  
  console.log(`找到 ${keysToDelete.length} 个已迁移的键`);
  
  if (dryRun) {
    console.log('[DRY RUN] 将删除以下键:');
    keysToDelete.slice(0, 10).forEach(k => console.log(`  - ${k}`));
    if (keysToDelete.length > 10) {
      console.log(`  ... 还有 ${keysToDelete.length - 10} 个键`);
    }
    return { deleted: keysToDelete.length, errors: [] };
  }
  
  return await deleteKeys(kv, keysToDelete, dryRun);
}

async function cleanupExpired(kv, dryRun = false) {
  console.log('清理过期的临时数据...');
  
  const now = Date.now();
  const keysToDelete = [];
  
  for (const prefix of EXPIRED_PREFIXES) {
    const keys = await listAllKeys(kv, prefix);
    
    for (const key of keys) {
      try {
        const record = await kv.get(key, { type: 'json' });
        if (record && record.expiresAt && record.expiresAt < now) {
          keysToDelete.push(key);
        } else if (prefix === 'session:' || prefix === 'chunk:' || prefix === 'upload:') {
          if (record && record.expires_at && record.expires_at < now) {
            keysToDelete.push(key);
          }
        }
      } catch (error) {
        console.error(`检查键失败: ${key}`, error);
      }
    }
  }
  
  console.log(`找到 ${keysToDelete.length} 个过期的键`);
  
  if (dryRun) {
    console.log('[DRY RUN] 将删除以下键:');
    keysToDelete.slice(0, 10).forEach(k => console.log(`  - ${k}`));
    if (keysToDelete.length > 10) {
      console.log(`  ... 还有 ${keysToDelete.length - 10} 个键`);
    }
    return { deleted: keysToDelete.length, errors: [] };
  }
  
  return await deleteKeys(kv, keysToDelete, dryRun);
}

async function cleanupByPrefix(kv, prefix, dryRun = false) {
  console.log(`清理前缀为 "${prefix}" 的数据...`);
  
  const keys = await listAllKeys(kv, prefix);
  console.log(`找到 ${keys.length} 个键`);
  
  if (dryRun) {
    console.log('[DRY RUN] 将删除以下键:');
    keys.slice(0, 10).forEach(k => console.log(`  - ${k}`));
    if (keys.length > 10) {
      console.log(`  ... 还有 ${keys.length - 10} 个键`);
    }
    return { deleted: keys.length, errors: [] };
  }
  
  return await deleteKeys(kv, keys, dryRun);
}

async function runCleanup(kv, options = {}) {
  if (options.help) {
    showHelp();
    return { success: true };
  }
  
  if (!options.migrated && !options.expired && !options.all && !options.prefix) {
    console.log('请指定要清理的数据类型，使用 --help 查看帮助');
    return { success: false, error: 'No cleanup type specified' };
  }
  
  console.log('========================================');
  console.log('KV 数据清理');
  console.log('========================================');
  console.log(`选项: migrated=${options.migrated}, expired=${options.expired}, all=${options.all}, dryRun=${options.dryRun}, prefix=${options.prefix}`);
  
  const results = {
    migrated: null,
    expired: null,
    prefix: null
  };
  
  try {
    if (options.prefix) {
      results.prefix = await cleanupByPrefix(kv, options.prefix, options.dryRun);
    }
    
    if (options.migrated || options.all) {
      results.migrated = await cleanupMigrated(kv, options.dryRun);
    }
    
    if (options.expired || options.all) {
      results.expired = await cleanupExpired(kv, options.dryRun);
    }
    
    console.log('========================================');
    console.log('KV 数据清理完成');
    console.log('========================================');
    
    return {
      success: true,
      results
    };
  } catch (error) {
    console.error('清理失败:', error);
    return {
      success: false,
      error: error.message,
      results
    };
  }
}

module.exports = {
  runCleanup,
  cleanupMigrated,
  cleanupExpired,
  cleanupByPrefix,
  listAllKeys,
  parseArgs,
  showHelp
};
