/**
 * 数据库 Schema 自动迁移
 * 在应用启动时检查并添加缺失的字段
 */

const MIGRATIONS = [
  {
    version: 1,
    name: 'add_physical_file_name',
    description: '添加 physical_file_name 字段用于文件名混淆',
    check: async (db) => {
      const result = await db.prepare(
        "SELECT COUNT(*) as count FROM pragma_table_info('files') WHERE name='physical_file_name'"
      ).first();
      return result?.count > 0;
    },
    migrate: async (db) => {
      await db.prepare('ALTER TABLE files ADD COLUMN physical_file_name TEXT').run();
    }
  },
  {
    version: 2,
    name: 'add_performance_indexes',
    description: '添加性能索引：files.folder_path, files.created_at, folders.parent_id',
    check: async (db) => {
      const result = await db.prepare(
        "SELECT COUNT(*) as count FROM pragma_index_list('files') WHERE name='idx_files_folder_path'"
      ).first();
      return result?.count > 0;
    },
    migrate: async (db) => {
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_files_folder_path ON files(folder_path)").run();
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at)").run();
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id)").run();
    }
  },
  {
    version: 3,
    name: 'add_data_column',
    description: '添加 data BLOB 列，支持 D1 直接存储文件数据',
    check: async (db) => {
      const result = await db.prepare(
        "SELECT COUNT(*) as count FROM pragma_table_info('files') WHERE name='data'"
      ).first();
      return result?.count > 0;
    },
    migrate: async (db) => {
      await db.prepare('ALTER TABLE files ADD COLUMN data BLOB').run();
    }
  },
  {
    version: 4,
    name: 'add_deleted_at',
    description: '添加 deleted_at 列，支持软删除/回收站功能',
    check: async (db) => {
      const result = await db.prepare(
        "SELECT COUNT(*) as count FROM pragma_table_info('files') WHERE name='deleted_at'"
      ).first();
      return result?.count > 0;
    },
    migrate: async (db) => {
      await db.prepare('ALTER TABLE files ADD COLUMN deleted_at INTEGER').run();
    }
  },
  {
    version: 5,
    name: 'add_users_table',
    description: '创建 users 表，替代 KV 存储用户资料和偏好设置',
    check: async (db) => {
      const result = await db.prepare(
        "SELECT COUNT(*) as count FROM pragma_table_info('users') WHERE name='id'"
      ).first();
      return result?.count > 0;
    },
    migrate: async (db) => {
      await db.prepare('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, nickname TEXT NOT NULL DEFAULT \'\', email TEXT NOT NULL DEFAULT \'\', pwd TEXT NOT NULL DEFAULT \'\', "group" TEXT NOT NULL DEFAULT \'user\', status TEXT NOT NULL DEFAULT \'active\', storage_capacity INTEGER NOT NULL DEFAULT 0, storage_used INTEGER NOT NULL DEFAULT 0, preferred_theme TEXT NOT NULL DEFAULT \'\', language TEXT NOT NULL DEFAULT \'\', settings_json TEXT NOT NULL DEFAULT \'{}\', download_secret TEXT NOT NULL DEFAULT \'\', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)').run();
      const now = Date.now();
      await db.prepare("INSERT OR IGNORE INTO users (id, nickname, email, created_at, updated_at) VALUES ('1', 'admin', '', ?, ?)").bind(now, now).run();
    }
  },
  {
    version: 6,
    name: 'add_config_table',
    description: '创建 config 表（每行一个设置项），将旧的 app_settings JSON 迁移为独立行',
    check: async (db) => {
      const tableCheck = await db.prepare(
        "SELECT COUNT(*) as count FROM pragma_table_info('app_settings') WHERE name='key'"
      ).first();
      if (!tableCheck?.count) return true;
      const row = await db.prepare("SELECT COUNT(*) as count FROM app_settings WHERE key = 'admin_settings'").first();
      return !row || row.count === 0;
    },
    migrate: async (db) => {
      await db.prepare("CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)").run();
      const oldRow = await db.prepare("SELECT value_json FROM app_settings WHERE key = 'admin_settings'").first();
      if (oldRow && oldRow.value_json) {
        try {
          const settings = JSON.parse(oldRow.value_json);
          const now = Date.now();
          const stmt = db.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)");
          for (const [key, val] of Object.entries(settings)) {
            await stmt.bind(key, String(val), now).run();
          }
          await db.prepare("DELETE FROM app_settings WHERE key = 'admin_settings'").run();
        } catch (e) {
          console.error('Migration v6: failed to parse admin_settings JSON', e);
        }
      }
    }
  },
  {
    version: 7,
    name: 'backfill_physical_file_name',
    description: '回填已有文件的 physical_file_name（无混淆的旧文件设为同名），兼容文件名混淆功能',
    check: async (db) => {
      const row = await db.prepare("SELECT COUNT(*) as count FROM files WHERE (physical_file_name IS NULL OR physical_file_name = '') AND storage_type != ''").first();
      return !row || row.count === 0;
    },
    migrate: async (db) => {
      await db.prepare("UPDATE files SET physical_file_name = file_name WHERE physical_file_name IS NULL OR physical_file_name = ''").run();
    }
  },
  {
    version: 8,
    name: 'add_download_secret',
    description: 'users 表新增 download_secret 列，用于文件下载签名',
    check: async (db) => {
      const result = await db.prepare(
        "SELECT COUNT(*) as count FROM pragma_table_info('users') WHERE name='download_secret'"
      ).first();
      return result?.count > 0;
    },
    migrate: async (db) => {
      await db.prepare("ALTER TABLE users ADD COLUMN download_secret TEXT NOT NULL DEFAULT ''").run();
      const users = await db.prepare("SELECT id FROM users").all();
      if (users.results) {
        for (const user of users.results) {
          const array = new Uint8Array(32);
          crypto.getRandomValues(array);
          const secret = Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
          await db.prepare("UPDATE users SET download_secret = ? WHERE id = ?").bind(secret, user.id).run();
        }
      }
    }
  },
  {
    version: 9,
    name: 'add_user_management_columns',
    description: 'users 表新增 pwd/group/status/storage_capacity/storage_used 列，支持多用户权限管理',
    check: async (db) => {
      const result = await db.prepare(
        "SELECT COUNT(*) as count FROM pragma_table_info('users') WHERE name='pwd'"
      ).first();
      return result?.count > 0;
    },
    migrate: async (db) => {
      const columns = [
        "ALTER TABLE users ADD COLUMN pwd TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE users ADD COLUMN \"group\" TEXT NOT NULL DEFAULT 'user'",
        "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
        "ALTER TABLE users ADD COLUMN storage_capacity INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN storage_used INTEGER NOT NULL DEFAULT 0"
      ];
      for (const sql of columns) {
        try {
          await db.prepare(sql).run();
        } catch (e) {
          // 列已存在则跳过
          if (!e.message?.includes('duplicate column')) throw e;
        }
      }
      await db.prepare("UPDATE users SET \"group\" = 'admin', status = 'active' WHERE id = '1'").run();
    }
  }
];

export async function runAutoMigrations(db, env = null) {
  const debug = env?.DEBUG === 'true';
  const results = [];
  
  for (const migration of MIGRATIONS) {
    try {
      const needsMigration = !(await migration.check(db));
      
      if (needsMigration) {
        if (debug) {
          console.log(`[Migration] Running: ${migration.name} - ${migration.description}`);
        }
        
        await migration.migrate(db);
        
        results.push({
          version: migration.version,
          name: migration.name,
          status: 'applied'
        });
        
        if (debug) {
          console.log(`[Migration] Completed: ${migration.name}`);
        }
      } else {
        results.push({
          version: migration.version,
          name: migration.name,
          status: 'skipped'
        });
      }
    } catch (error) {
      console.error(`[Migration] Failed: ${migration.name}`, error);
      results.push({
        version: migration.version,
        name: migration.name,
        status: 'failed',
        error: error.message
      });
    }
  }
  
  return results;
}

export async function ensureTablesExist(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS storage_configs (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, encrypted_payload TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, path TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, storage_config_id TEXT NOT NULL DEFAULT 'default', storage_type TEXT NOT NULL, storage_key TEXT NOT NULL, storage_file_id TEXT, file_name TEXT NOT NULL, physical_file_name TEXT, file_size INTEGER NOT NULL DEFAULT 0, mime_type TEXT, folder_id TEXT, folder_path TEXT NOT NULL DEFAULT '', list_type TEXT NOT NULL DEFAULT 'None', label TEXT NOT NULL DEFAULT 'None', liked INTEGER NOT NULL DEFAULT 0, extra_json TEXT NOT NULL DEFAULT '{}', deleted_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, file_id TEXT NOT NULL, password_hash TEXT, expires_at INTEGER, max_downloads INTEGER DEFAULT 0, download_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS api_tokens (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_used_at INTEGER, enabled INTEGER NOT NULL DEFAULT 1)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)").run();
  await db.prepare('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, nickname TEXT NOT NULL DEFAULT \'\', email TEXT NOT NULL DEFAULT \'\', pwd TEXT NOT NULL DEFAULT \'\', "group" TEXT NOT NULL DEFAULT \'user\', status TEXT NOT NULL DEFAULT \'active\', storage_capacity INTEGER NOT NULL DEFAULT 0, storage_used INTEGER NOT NULL DEFAULT 0, preferred_theme TEXT NOT NULL DEFAULT \'\', language TEXT NOT NULL DEFAULT \'\', settings_json TEXT NOT NULL DEFAULT \'{}\', download_secret TEXT NOT NULL DEFAULT \'\', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)').run();
}
