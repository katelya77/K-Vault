const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS = [
  {
    version: 1,
    name: 'add_physical_file_name',
    check: (db) => {
      try {
        const result = db.prepare(
          "SELECT COUNT(*) as count FROM pragma_table_info('files') WHERE name='physical_file_name'"
        ).get();
        return result?.count > 0;
      } catch {
        return false;
      }
    },
    migrate: (db) => {
      db.exec('ALTER TABLE files ADD COLUMN physical_file_name TEXT');
    }
  }
];

function executeStatement(stmt, method, params) {
  if (params == null) {
    return stmt[method]();
  }
  if (Array.isArray(params)) {
    return stmt[method](...params);
  }
  return stmt[method](params);
}

function runMigrations(db) {
  for (const migration of MIGRATIONS) {
    try {
      if (!migration.check(db)) {
        console.log(`[Migration] Running: ${migration.name}`);
        migration.migrate(db);
        console.log(`[Migration] Completed: ${migration.name}`);
      }
    } catch (error) {
      console.error(`[Migration] Failed: ${migration.name}`, error.message);
    }
  }
}

function initDatabase(dbPath) {
  const fullPath = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });

  const db = new DatabaseSync(fullPath);
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
  
  runMigrations(db);

  return db;
}

function run(db, sql, params) {
  const stmt = db.prepare(sql);
  return executeStatement(stmt, 'run', params);
}

function get(db, sql, params) {
  const stmt = db.prepare(sql);
  return executeStatement(stmt, 'get', params);
}

function all(db, sql, params) {
  const stmt = db.prepare(sql);
  return executeStatement(stmt, 'all', params);
}

function transaction(db, callback) {
  db.exec('BEGIN');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function cleanupExpiredState(db) {
  const now = Date.now();
  run(db, 'DELETE FROM sessions WHERE expires_at <= ?', [now]);
  run(db, 'DELETE FROM chunk_uploads WHERE expires_at <= ?', [now]);
}

module.exports = {
  initDatabase,
  run,
  get,
  all,
  transaction,
  cleanupExpiredState,
};
