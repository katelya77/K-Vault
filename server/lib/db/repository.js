/**
 * 统一数据库访问层
 * 支持 D1 (Cloudflare Pages) 和 SQLite (Docker)
 */

import { debugLog, debugError } from '../../functions/utils/debug.js';

export class DatabaseClient {
  constructor(db) {
    this.db = db;
  }

  async prepare(sql) {
    return this.db.prepare(sql);
  }

  async exec(sql) {
    if (this.db.exec) {
      return this.db.exec(sql);
    }
    return this.db.prepare(sql).run();
  }

  async transaction(callback) {
    if (this.db.batch) {
      return this.db.batch(callback);
    }
    await this.exec('BEGIN TRANSACTION');
    try {
      const result = await callback(this);
      await this.exec('COMMIT');
      return result;
    } catch (error) {
      await this.exec('ROLLBACK');
      throw error;
    }
  }
}

/**
 * 创建 D1 数据库客户端
 */
export function createD1Client(d1Database) {
  return new DatabaseClient(d1Database);
}

/**
 * 创建 SQLite 数据库客户端
 */
export function createSQLiteClient(sqliteDatabase) {
  return new DatabaseClient(sqliteDatabase);
}

/**
 * 文件仓库
 */
export class FileRepository {
  constructor(db, env = null) {
    this.db = db;
    this.env = env;
  }

  async create(fileData) {
    const {
      id,
      storageConfigId,
      storageType,
      storageKey,
      storageFileId,
      fileName,
      physicalFileName,
      fileSize,
      mimeType,
      folderId,
      folderPath,
      listType = 'None',
      label = 'None',
      liked = false,
      extraJson = '{}'
    } = fileData;

    debugLog(this.env, 'DB', 'Creating file record', { id, fileName, storageType });

    const now = Date.now();
    
    await this.db.prepare(`
      INSERT INTO files (
        id, storage_config_id, storage_type, storage_key, storage_file_id,
        file_name, physical_file_name, file_size, mime_type, folder_id, folder_path,
        list_type, label, liked, extra_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, storageConfigId, storageType, storageKey, storageFileId,
      fileName, physicalFileName, fileSize, mimeType, folderId, folderPath,
      listType, label, liked ? 1 : 0, extraJson, now, now
    ).run();

    return await this.findById(id);
  }

  async findById(id) {
    debugLog(this.env, 'DB', 'Finding file by ID', { id });
    const result = await this.db.prepare(`
      SELECT * FROM files WHERE id = ?
    `).bind(id).first();
    
    if (result) {
      debugLog(this.env, 'DB', 'File found by ID', { id, fileName: result.file_name });
    } else {
      debugLog(this.env, 'DB', 'File not found by ID', { id });
    }
    
    return result;
  }

  async findByStorageKey(storageKey) {
    debugLog(this.env, 'DB', 'Finding file by storage key', { storageKey });
    const result = await this.db.prepare(`
      SELECT * FROM files WHERE storage_key = ?
    `).bind(storageKey).first();
    
    if (result) {
      debugLog(this.env, 'DB', 'File found by storage key', { storageKey, fileName: result.file_name });
    } else {
      debugLog(this.env, 'DB', 'File not found by storage key', { storageKey });
    }
    
    return result;
  }

  async findByFileId(fileId) {
    debugLog(this.env, 'DB', 'Finding file by file ID', { fileId });
    const result = await this.db.prepare(`
      SELECT * FROM files 
      WHERE id = ? OR storage_key = ? OR physical_file_name = ?
      LIMIT 1
    `).bind(fileId, fileId, fileId).first();
    
    if (result) {
      debugLog(this.env, 'DB', 'File found by file ID', { fileId, fileName: result.file_name });
    } else {
      debugLog(this.env, 'DB', 'File not found by file ID', { fileId });
    }
    
    return result;
  }

  async list(options = {}) {
    const {
      folderId,
      storageType,
      listType,
      liked,
      page = 1,
      pageSize = 20,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = options;

    const offset = (page - 1) * pageSize;
    const conditions = [];
    const params = [];

    if (folderId !== undefined) {
      conditions.push('folder_id = ?');
      params.push(folderId);
    }

    if (storageType) {
      conditions.push('storage_type = ?');
      params.push(storageType);
    }

    if (listType) {
      conditions.push('list_type = ?');
      params.push(listType);
    }

    if (liked !== undefined) {
      conditions.push('liked = ?');
      params.push(liked ? 1 : 0);
    }

    const whereClause = conditions.length > 0 
      ? `WHERE ${conditions.join(' AND ')}` 
      : '';

    const validSortColumns = ['created_at', 'file_size', 'file_name'];
    const validSortOrders = ['ASC', 'DESC'];
    const safeSortBy = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = validSortOrders.includes(sortOrder.toUpperCase()) 
      ? sortOrder.toUpperCase() 
      : 'DESC';

    const countResult = await this.db.prepare(`
      SELECT COUNT(*) as total FROM files ${whereClause}
    `).bind(...params).first();

    const items = await this.db.prepare(`
      SELECT * FROM files ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      LIMIT ? OFFSET ?
    `).bind(...params, pageSize, offset).all();

    return {
      items: items.results || [],
      total: countResult?.total || 0,
      page,
      pageSize,
      totalPages: Math.ceil((countResult?.total || 0) / pageSize)
    };
  }

  async update(id, updates) {
    const allowedFields = [
      'file_name', 'physical_file_name', 'folder_id', 'folder_path', 'list_type', 
      'label', 'liked', 'extra_json'
    ];
    
    const setClauses = [];
    const params = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = ?`);
        params.push(value);
      }
    }
    
    if (setClauses.length === 0) {
      return await this.findById(id);
    }
    
    setClauses.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);
    
    await this.db.prepare(`
      UPDATE files 
      SET ${setClauses.join(', ')}
      WHERE id = ?
    `).bind(...params).run();
    
    return await this.findById(id);
  }

  async count(options = {}) {
    const conditions = [];
    const params = [];

    if (options.folderId !== undefined) {
      conditions.push('folder_id = ?');
      params.push(options.folderId);
    }

    if (options.storageType) {
      conditions.push('storage_type = ?');
      params.push(options.storageType);
    }

    if (options.listType) {
      conditions.push('list_type = ?');
      params.push(options.listType);
    }

    if (options.liked !== undefined) {
      conditions.push('liked = ?');
      params.push(options.liked ? 1 : 0);
    }

    const whereClause = conditions.length > 0 
      ? `WHERE ${conditions.join(' AND ')}` 
      : '';

    const result = await this.db.prepare(`
      SELECT COUNT(*) as total FROM files ${whereClause}
    `).bind(...params).first();

    return result?.total || 0;
  }

  async delete(id) {
    await this.db.prepare(`
      DELETE FROM files WHERE id = ?
    `).bind(id).run();
  }

  async search(query, options = {}) {
    const {
      page = 1,
      pageSize = 20
    } = options;

    const offset = (page - 1) * pageSize;
    const searchTerm = `%${query}%`;

    const countResult = await this.db.prepare(`
      SELECT COUNT(*) as total 
      FROM files 
      WHERE file_name LIKE ? OR mime_type LIKE ?
    `).bind(searchTerm, searchTerm).first();

    const items = await this.db.prepare(`
      SELECT * FROM files 
      WHERE file_name LIKE ? OR mime_type LIKE ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(searchTerm, searchTerm, pageSize, offset).all();

    return {
      items: items.results || [],
      total: countResult?.total || 0,
      page,
      pageSize,
      totalPages: Math.ceil((countResult?.total || 0) / pageSize)
    };
  }
}

/**
 * 文件夹仓库
 */
export class FolderRepository {
  constructor(db) {
    this.db = db;
  }

  async create(folderData) {
    const { id, name, parentId, path } = folderData;
    const now = Date.now();
    
    await this.db.prepare(`
      INSERT INTO folders (id, name, parent_id, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, name, parentId, path, now, now).run();
    
    return await this.findById(id);
  }

  async findById(id) {
    return await this.db.prepare(`
      SELECT * FROM folders WHERE id = ?
    `).bind(id).first();
  }

  async findByPath(path) {
    return await this.db.prepare(`
      SELECT * FROM folders WHERE path = ?
    `).bind(path).first();
  }

  async list(parentId = null) {
    const items = await this.db.prepare(`
      SELECT * FROM folders 
      WHERE parent_id ${parentId ? '= ?' : 'IS NULL'}
      ORDER BY name ASC
    `).bind(parentId).all();
    
    return items.results || [];
  }

  async getChildren(folderId) {
    const items = await this.db.prepare(`
      SELECT * FROM folders WHERE parent_id = ?
      ORDER BY name ASC
    `).bind(folderId).all();
    
    return items.results || [];
  }

  async delete(id) {
    await this.db.prepare(`
      DELETE FROM folders WHERE id = ?
    `).bind(id).run();
  }

  async getTree(folderId = null, depth = 0) {
    if (depth > 100) return [];
    
    const folders = await this.list(folderId);
    const tree = [];
    
    for (const folder of folders) {
      const children = await this.getTree(folder.id, depth + 1);
      tree.push({
        ...folder,
        children
      });
    }
    
    return tree;
  }
}

/**
 * 分享链接仓库
 */
export class ShareRepository {
  constructor(db) {
    this.db = db;
  }

  async create(shareData) {
    const {
      id,
      slug,
      fileId,
      passwordHash,
      expiresAt,
      maxDownloads = 0
    } = shareData;

    const now = Date.now();
    
    await this.db.prepare(`
      INSERT INTO shares (
        id, slug, file_id, password_hash, expires_at,
        max_downloads, download_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, slug, fileId, passwordHash, expiresAt,
      maxDownloads, 0, now
    ).run();
    
    return await this.findById(id);
  }

  async findById(id) {
    return await this.db.prepare(`
      SELECT * FROM shares WHERE id = ?
    `).bind(id).first();
  }

  async findBySlug(slug) {
    return await this.db.prepare(`
      SELECT * FROM shares WHERE slug = ?
    `).bind(slug).first();
  }

  async incrementDownloadCount(id) {
    await this.db.prepare(`
      UPDATE shares 
      SET download_count = download_count + 1
      WHERE id = ?
    `).bind(id).run();
  }

  async delete(id) {
    await this.db.prepare(`
      DELETE FROM shares WHERE id = ?
    `).bind(id).run();
  }

  async deleteExpired() {
    const now = Date.now();
    await this.db.prepare(`
      DELETE FROM shares 
      WHERE expires_at IS NOT NULL AND expires_at < ?
    `).bind(now).run();
  }

  async list(options = {}) {
    const {
      page = 1,
      pageSize = 20
    } = options;

    const offset = (page - 1) * pageSize;

    const countResult = await this.db.prepare(`
      SELECT COUNT(*) as total FROM shares
    `).first();

    const items = await this.db.prepare(`
      SELECT * FROM shares
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(pageSize, offset).all();

    return {
      items: items.results || [],
      total: countResult?.total || 0,
      page,
      pageSize,
      totalPages: Math.ceil((countResult?.total || 0) / pageSize)
    };
  }
}

/**
 * API Token 仓库
 */
export class ApiTokenRepository {
  constructor(db) {
    this.db = db;
  }

  async create(tokenData) {
    const { id, name, tokenHash } = tokenData;
    const now = Date.now();
    
    await this.db.prepare(`
      INSERT INTO api_tokens (id, name, token_hash, created_at, enabled)
      VALUES (?, ?, ?, ?, 1)
    `).bind(id, name, tokenHash, now).run();
    
    return await this.findById(id);
  }

  async findById(id) {
    return await this.db.prepare(`
      SELECT * FROM api_tokens WHERE id = ?
    `).bind(id).first();
  }

  async findByTokenHash(tokenHash) {
    return await this.db.prepare(`
      SELECT * FROM api_tokens WHERE token_hash = ?
    `).bind(tokenHash).first();
  }

  async list(options = {}) {
    const {
      page = 1,
      pageSize = 20
    } = options;

    const offset = (page - 1) * pageSize;

    const countResult = await this.db.prepare(`
      SELECT COUNT(*) as total FROM api_tokens
    `).first();

    const items = await this.db.prepare(`
      SELECT id, name, token_hash, created_at, last_used_at, enabled 
      FROM api_tokens 
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(pageSize, offset).all();

    return {
      items: items.results || [],
      total: countResult?.total || 0,
      page,
      pageSize,
      totalPages: Math.ceil((countResult?.total || 0) / pageSize)
    };
  }

  async updateLastUsed(id) {
    await this.db.prepare(`
      UPDATE api_tokens 
      SET last_used_at = ?
      WHERE id = ?
    `).bind(Date.now(), id).run();
  }

  async update(id, updates) {
    const setClauses = [];
    const params = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      params.push(updates.name);
    }

    if (updates.enabled !== undefined) {
      setClauses.push('enabled = ?');
      params.push(updates.enabled ? 1 : 0);
    }

    if (setClauses.length === 0) {
      return await this.findById(id);
    }

    setClauses.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);

    await this.db.prepare(`
      UPDATE api_tokens 
      SET ${setClauses.join(', ')}
      WHERE id = ?
    `).bind(...params).run();

    return await this.findById(id);
  }

  async delete(id) {
    await this.db.prepare(`
      DELETE FROM api_tokens WHERE id = ?
    `).bind(id).run();
  }
}

/**
 * 存储配置仓库
 */
export class StorageConfigRepository {
  constructor(db) {
    this.db = db;
  }

  async create(configData) {
    const {
      id,
      name,
      type,
      encryptedPayload,
      isDefault = false,
      enabled = true,
      metadataJson = '{}'
    } = configData;

    const now = Date.now();
    
    await this.db.prepare(`
      INSERT INTO storage_configs (
        id, name, type, encrypted_payload, is_default, enabled,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, name, type, encryptedPayload, isDefault ? 1 : 0, enabled ? 1 : 0,
      metadataJson, now, now
    ).run();
    
    return await this.findById(id);
  }

  async findById(id) {
    return await this.db.prepare(`
      SELECT * FROM storage_configs WHERE id = ?
    `).bind(id).first();
  }

  async list() {
    const items = await this.db.prepare(`
      SELECT * FROM storage_configs 
      ORDER BY is_default DESC, created_at DESC
    `).all();
    
    return items.results || [];
  }

  async getDefault() {
    return await this.db.prepare(`
      SELECT * FROM storage_configs 
      WHERE is_default = 1 AND enabled = 1
      LIMIT 1
    `).first();
  }

  async setDefault(id) {
    await this.db.transaction(async (db) => {
      await db.prepare(`
        UPDATE storage_configs SET is_default = 0
      `).run();
      
      await db.prepare(`
        UPDATE storage_configs 
        SET is_default = 1, updated_at = ?
        WHERE id = ?
      `).bind(Date.now(), id).run();
    });
  }

  async update(id, updates) {
    const allowedFields = ['name', 'encrypted_payload', 'is_default', 'enabled', 'metadata_json'];
    const setClauses = [];
    const params = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = ?`);
        params.push(value);
      }
    }
    
    if (setClauses.length === 0) {
      return await this.findById(id);
    }
    
    setClauses.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);
    
    await this.db.prepare(`
      UPDATE storage_configs 
      SET ${setClauses.join(', ')}
      WHERE id = ?
    `).bind(...params).run();
    
    return await this.findById(id);
  }

  async delete(id) {
    await this.db.prepare(`
      DELETE FROM storage_configs WHERE id = ?
    `).bind(id).run();
  }
}
