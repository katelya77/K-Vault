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
  await db.prepare("CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, storage_config_id TEXT NOT NULL DEFAULT 'default', storage_type TEXT NOT NULL, storage_key TEXT NOT NULL, storage_file_id TEXT, file_name TEXT NOT NULL, physical_file_name TEXT, file_size INTEGER NOT NULL DEFAULT 0, mime_type TEXT, folder_id TEXT, folder_path TEXT NOT NULL DEFAULT '', list_type TEXT NOT NULL DEFAULT 'None', label TEXT NOT NULL DEFAULT 'None', liked INTEGER NOT NULL DEFAULT 0, extra_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, file_id TEXT NOT NULL, password_hash TEXT, expires_at INTEGER, max_downloads INTEGER DEFAULT 0, download_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS api_tokens (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_used_at INTEGER, enabled INTEGER NOT NULL DEFAULT 1)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL)").run();
}
