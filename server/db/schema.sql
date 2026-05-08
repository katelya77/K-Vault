PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================
-- 文件夹表（支持无限级层级结构）
-- ============================================
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  path TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_folders_path ON folders(path);
CREATE INDEX IF NOT EXISTS idx_folders_updated_at ON folders(updated_at DESC);

-- ============================================
-- 存储配置表
-- ============================================
CREATE TABLE IF NOT EXISTS storage_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_storage_configs_type ON storage_configs(type);
CREATE INDEX IF NOT EXISTS idx_storage_configs_default ON storage_configs(is_default);
CREATE INDEX IF NOT EXISTS idx_storage_configs_enabled ON storage_configs(enabled);

-- ============================================
-- 文件元数据表
-- ============================================
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  storage_config_id TEXT NOT NULL,
  storage_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  storage_file_id TEXT,
  file_name TEXT NOT NULL,
  physical_file_name TEXT,
  file_size INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT,
  folder_id TEXT,
  folder_path TEXT NOT NULL DEFAULT '',
  list_type TEXT NOT NULL DEFAULT 'None',
  label TEXT NOT NULL DEFAULT 'None',
  liked INTEGER NOT NULL DEFAULT 0,
  extra_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (storage_config_id) REFERENCES storage_configs(id) ON DELETE RESTRICT,
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
);

-- 文件查询索引（优化性能）
CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_storage_type ON files(storage_type);
CREATE INDEX IF NOT EXISTS idx_files_list_type ON files(list_type);
CREATE INDEX IF NOT EXISTS idx_files_folder_id ON files(folder_id);
CREATE INDEX IF NOT EXISTS idx_files_folder_path ON files(folder_path);
CREATE INDEX IF NOT EXISTS idx_files_storage_key ON files(storage_key);
CREATE INDEX IF NOT EXISTS idx_files_liked ON files(liked);

-- 复合索引（用于文件夹内的文件列表查询）
CREATE INDEX IF NOT EXISTS idx_files_folder_created ON files(folder_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_folder_storage ON files(folder_id, storage_type);

-- ============================================
-- 分享链接表
-- ============================================
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  file_id TEXT NOT NULL,
  password_hash TEXT,
  expires_at INTEGER,
  max_downloads INTEGER DEFAULT 0,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shares_slug ON shares(slug);
CREATE INDEX IF NOT EXISTS idx_shares_file_id ON shares(file_id);
CREATE INDEX IF NOT EXISTS idx_shares_expires_at ON shares(expires_at);

-- ============================================
-- API Token 表
-- ============================================
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_api_tokens_enabled ON api_tokens(enabled);

-- ============================================
-- 虚拟文件夹表（兼容旧数据）
-- ============================================
CREATE TABLE IF NOT EXISTS virtual_folders (
  path TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_virtual_folders_updated_at ON virtual_folders(updated_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS guest_upload_counters (
  id TEXT PRIMARY KEY,
  ip TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_guest_upload_counters_day ON guest_upload_counters(day);

CREATE TABLE IF NOT EXISTS chunk_uploads (
  upload_id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_type TEXT,
  total_chunks INTEGER NOT NULL,
  storage_mode TEXT,
  storage_config_id TEXT,
  folder_path TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunk_uploads_expires_at ON chunk_uploads(expires_at);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_settings_updated_at ON app_settings(updated_at DESC);
