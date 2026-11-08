const { all, get, run } = require('../../db');
const { publicShareMetadata } = require('../utils/share-password.cjs');

function parseExtra(extraJson) {
  try {
    return JSON.parse(extraJson || '{}');
  } catch {
    return {};
  }
}

function normalizeFolderPath(value) {
  const raw = String(value || '').replace(/\\/g, '/');
  const segments = [];
  for (const segment of raw.split('/')) {
    const normalized = segment.trim();
    if (!normalized || normalized === '.') continue;
    if (normalized === '..') {
      segments.pop();
      continue;
    }
    segments.push(normalized);
  }
  return segments.join('/');
}

function getFolderParent(pathValue) {
  const path = normalizeFolderPath(pathValue);
  if (!path) return '';
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

function getFolderName(pathValue) {
  const path = normalizeFolderPath(pathValue);
  if (!path) return 'All Files';
  const parts = path.split('/');
  return parts[parts.length - 1];
}

function buildAncestors(pathValue) {
  const path = normalizeFolderPath(pathValue);
  if (!path) return [];
  const parts = path.split('/');
  const result = [];
  for (let i = 1; i <= parts.length; i += 1) {
    result.push(parts.slice(0, i).join('/'));
  }
  return result;
}

function replacePathPrefix(currentPathValue, sourcePrefixValue, targetPrefixValue) {
  const currentPath = normalizeFolderPath(currentPathValue);
  const sourcePrefix = normalizeFolderPath(sourcePrefixValue);
  const targetPrefix = normalizeFolderPath(targetPrefixValue);

  if (currentPath === sourcePrefix) return targetPrefix;
  if (!currentPath.startsWith(`${sourcePrefix}/`)) return currentPath;

  const suffix = currentPath.slice(sourcePrefix.length + 1);
  return targetPrefix ? `${targetPrefix}/${suffix}` : suffix;
}

function toMetadata(row) {
  const extra = parseExtra(row.extra_json);
  return {
    TimeStamp: row.created_at,
    ListType: row.list_type || 'None',
    Label: row.label || 'None',
    liked: Boolean(row.liked),
    fileName: row.file_name,
    fileSize: row.file_size || 0,
    storageType: row.storage_type,
    storageConfigId: row.storage_config_id,
    mimeType: row.mime_type || '',
    folderPath: normalizeFolderPath(row.folder_path),
    ...extra,
  };
}

function mapRow(row) {
  return {
    name: row.id,
    metadata: publicShareMetadata(toMetadata(row)),
  };
}

class FileRepository {
  constructor(db) {
    this.db = db;
    this.ensureSchema();
  }

  ensureSchema() {
    const fileColumns = all(this.db, 'PRAGMA table_info(files)');
    const hasFolderPath = fileColumns.some((column) => column.name === 'folder_path');
    if (!hasFolderPath) {
      run(this.db, `ALTER TABLE files ADD COLUMN folder_path TEXT NOT NULL DEFAULT ''`);
    }
    run(this.db, `CREATE INDEX IF NOT EXISTS idx_files_folder_path ON files(folder_path)`);

    run(
      this.db,
      `CREATE TABLE IF NOT EXISTS virtual_folders (
        path TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    );
    run(this.db, `CREATE INDEX IF NOT EXISTS idx_virtual_folders_updated_at ON virtual_folders(updated_at DESC)`);
  }

  upsertFolder(pathValue) {
    const path = normalizeFolderPath(pathValue);
    if (!path) return;
    const now = Date.now();
    run(
      this.db,
      `INSERT INTO virtual_folders(path, created_at, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET updated_at = excluded.updated_at`,
      [path, now, now]
    );
  }

  ensureFolderPath(pathValue) {
    const path = normalizeFolderPath(pathValue);
    if (!path) return;
    buildAncestors(path).forEach((ancestor) => this.upsertFolder(ancestor));
  }

  createFolder(pathValue) {
    const path = normalizeFolderPath(pathValue);
    if (!path) {
      throw new Error('Folder path cannot be empty.');
    }
    this.ensureFolderPath(path);
    return this.getFolderByPath(path);
  }

  getFolderByPath(pathValue) {
    const path = normalizeFolderPath(pathValue);
    if (!path) {
      return { path: '', name: 'All Files', parentPath: '' };
    }
    return {
      path,
      name: getFolderName(path),
      parentPath: getFolderParent(path),
    };
  }

  create(file) {
    const now = Date.now();
    const folderPath = normalizeFolderPath(file.folderPath);
    if (folderPath) this.ensureFolderPath(folderPath);

    run(
      this.db,
      `INSERT INTO files(
        id, storage_config_id, storage_type, storage_key, file_name,
        file_size, mime_type, list_type, label, liked, extra_json, folder_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        file.id,
        file.storageConfigId,
        file.storageType,
        file.storageKey,
        file.fileName,
        file.fileSize || 0,
        file.mimeType || 'application/octet-stream',
        file.listType || 'None',
        file.label || 'None',
        file.liked ? 1 : 0,
        JSON.stringify(file.extra || {}),
        folderPath,
        now,
        now,
      ]
    );

    return this.getById(file.id);
  }

  getById(id) {
    const row = get(this.db, 'SELECT * FROM files WHERE id = ?', [id]);
    if (!row) return null;
    return {
      ...row,
      metadata: toMetadata(row),
    };
  }

  findByShareSlug(slugValue) {
    const slug = String(slugValue || '').trim().toLowerCase();
    if (!slug) return null;

    const rows = all(this.db, 'SELECT * FROM files ORDER BY created_at DESC');
    for (const row of rows) {
      const extra = parseExtra(row.extra_json);
      const current = String(extra.shareSlug || '').trim().toLowerCase();
      if (current !== slug) continue;
      return {
        ...row,
        metadata: toMetadata(row),
      };
    }

    return null;
  }

  updateMetadata(id, patch = {}) {
    const current = this.getById(id);
    if (!current) return null;

    const hasFolderPathPatch = Object.prototype.hasOwnProperty.call(patch, 'folderPath');
    const nextFolderPath = hasFolderPathPatch
      ? normalizeFolderPath(patch.folderPath)
      : normalizeFolderPath(current.folder_path);

    if (nextFolderPath) this.ensureFolderPath(nextFolderPath);

    const nextExtra = { ...parseExtra(current.extra_json), ...(patch.extra || {}) };

    run(
      this.db,
      `UPDATE files
       SET file_name = ?,
           list_type = ?,
           label = ?,
           liked = ?,
           extra_json = ?,
           folder_path = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        patch.fileName || current.file_name,
        patch.listType || current.list_type,
        patch.label || current.label,
        patch.liked != null ? (patch.liked ? 1 : 0) : current.liked,
        JSON.stringify(nextExtra),
        nextFolderPath,
        Date.now(),
        id,
      ]
    );

    return this.getById(id);
  }

  delete(id) {
    const result = run(this.db, 'DELETE FROM files WHERE id = ?', [id]);
    return Number(result.changes || 0) > 0;
  }

  deleteBatch(ids = []) {
    const normalizedIds = Array.from(
      new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean))
    );
    if (normalizedIds.length === 0) return { deleted: 0 };

    const placeholders = normalizedIds.map(() => '?').join(', ');
    const result = run(this.db, `DELETE FROM files WHERE id IN (${placeholders})`, normalizedIds);
    return { deleted: Number(result.changes || 0) };
  }

  normalizeFileIdentifiers(ids = []) {
    return Array.from(
      new Set(
        (Array.isArray(ids) ? ids : [])
          .map((id) => {
            const raw = String(id || '').trim();
            if (!raw) return '';
            try {
              return decodeURIComponent(raw);
            } catch {
              return raw;
            }
          })
          .map((id) => id.replace(/^https?:\/\/[^/]+\/file\//i, '').replace(/^\/?file\//i, '').trim())
          .filter(Boolean)
      )
    );
  }

  resolveMoveFileIds(ids = []) {
    const identifiers = this.normalizeFileIdentifiers(ids);
    if (identifiers.length === 0) return { requested: 0, ids: [], notFound: [] };

    const resolved = new Set();
    const notFound = [];
    const placeholders = identifiers.map(() => '?').join(', ');
    const exactRows = all(this.db, `SELECT id FROM files WHERE id IN (${placeholders})`, identifiers);
    exactRows.forEach((row) => resolved.add(row.id));

    for (const identifier of identifiers) {
      if (resolved.has(identifier)) continue;
      const rows = all(this.db, `SELECT id FROM files WHERE file_name = ? LIMIT 2`, [identifier]);
      if (rows.length === 1) {
        resolved.add(rows[0].id);
      } else {
        notFound.push(identifier);
      }
    }

    return {
      requested: identifiers.length,
      ids: Array.from(resolved),
      notFound,
    };
  }

  moveFiles(ids = [], targetFolderPath = '') {
    const resolved = this.resolveMoveFileIds(ids);
    if (resolved.ids.length === 0) {
      return { moved: 0, targetFolderPath: normalizeFolderPath(targetFolderPath) };
    }

    const targetPath = normalizeFolderPath(targetFolderPath);
    if (targetPath) this.ensureFolderPath(targetPath);

    const placeholders = resolved.ids.map(() => '?').join(', ');
    const result = run(
      this.db,
      `UPDATE files SET folder_path = ?, updated_at = ? WHERE id IN (${placeholders})`,
      [targetPath, Date.now(), ...resolved.ids]
    );

    return {
      requested: resolved.requested,
      moved: Number(result.changes || 0),
      notFound: resolved.notFound,
      targetFolderPath: targetPath,
    };
  }

  moveFolder(sourcePathValue, targetPathValue) {
    const sourcePath = normalizeFolderPath(sourcePathValue);
    const targetPath = normalizeFolderPath(targetPathValue);

    if (!sourcePath) {
      throw new Error('sourcePath is required.');
    }
    if (!targetPath) {
      throw new Error('targetPath is required.');
    }
    if (sourcePath === targetPath) {
      return { sourcePath, targetPath, movedFiles: 0, movedFolders: 0 };
    }
    if (targetPath.startsWith(`${sourcePath}/`)) {
      throw new Error('Cannot move folder into its own subfolder.');
    }

    this.ensureFolderPath(targetPath);

    const fileRows = all(
      this.db,
      `SELECT id, folder_path FROM files
       WHERE folder_path = ? OR folder_path LIKE ?`,
      [sourcePath, `${sourcePath}/%`]
    );

    let movedFiles = 0;
    for (const row of fileRows) {
      const nextFolderPath = replacePathPrefix(row.folder_path, sourcePath, targetPath);
      const result = run(this.db, `UPDATE files SET folder_path = ?, updated_at = ? WHERE id = ?`, [
        nextFolderPath,
        Date.now(),
        row.id,
      ]);
      movedFiles += Number(result.changes || 0);
    }

    const folderRows = all(
      this.db,
      `SELECT path FROM virtual_folders
       WHERE path = ? OR path LIKE ?`,
      [sourcePath, `${sourcePath}/%`]
    );
    const oldFolders = new Set([sourcePath, ...folderRows.map((row) => normalizeFolderPath(row.path)).filter(Boolean)]);

    for (const oldPath of oldFolders) {
      const nextPath = replacePathPrefix(oldPath, sourcePath, targetPath);
      this.ensureFolderPath(nextPath);
    }

    run(this.db, `DELETE FROM virtual_folders WHERE path = ? OR path LIKE ?`, [sourcePath, `${sourcePath}/%`]);

    return {
      sourcePath,
      targetPath,
      movedFiles,
      movedFolders: oldFolders.size,
    };
  }

  listFileIdsByFolderPrefix(pathValue) {
    const path = normalizeFolderPath(pathValue);
    if (!path) return [];

    const rows = all(
      this.db,
      `SELECT id FROM files
       WHERE folder_path = ? OR folder_path LIKE ?
       ORDER BY created_at DESC`,
      [path, `${path}/%`]
    );
    return rows.map((row) => row.id);
  }

  deleteFolder(pathValue, { recursive = false } = {}) {
    const path = normalizeFolderPath(pathValue);
    if (!path) {
      throw new Error('Folder path cannot be root.');
    }

    const childFolder = get(this.db, `SELECT path FROM virtual_folders WHERE path LIKE ? LIMIT 1`, [`${path}/%`]);
    const childFile = get(this.db, `SELECT id FROM files WHERE folder_path = ? OR folder_path LIKE ? LIMIT 1`, [
      path,
      `${path}/%`,
    ]);

    if (!recursive && (childFolder || childFile)) {
      throw new Error('Folder is not empty. Use recursive delete to remove all nested data.');
    }

    const result = run(
      this.db,
      `DELETE FROM virtual_folders
       WHERE path = ? OR path LIKE ?`,
      [path, `${path}/%`]
    );

    return {
      path,
      deletedFolders: Number(result.changes || 0),
      hadFiles: Boolean(childFile),
    };
  }

  count(filters = {}) {
    const { whereClause, params } = this.buildWhere(filters);
    const row = get(this.db, `SELECT COUNT(1) AS c FROM files ${whereClause}`, params);
    return Number(row?.c || 0);
  }

  list({
    limit = 100,
    cursor,
    filters = {},
    includeStats = false,
  } = {}) {
    const normalizedLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
    const offset = Math.max(0, Number(cursor) || 0);

    const { whereClause, params } = this.buildWhere(filters);

    const rows = all(
      this.db,
      `SELECT * FROM files ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, normalizedLimit, offset]
    );

    const total = this.count(filters);
    const nextOffset = offset + rows.length;

    const payload = {
      keys: rows.map(mapRow),
      list_complete: nextOffset >= total,
      cursor: nextOffset >= total ? null : String(nextOffset),
      pageCount: rows.length,
    };

    if (includeStats) {
      payload.stats = this.buildStats(filters);
    }

    return payload;
  }

  listExplorer({
    folderPath = '',
    limit = 100,
    cursor = null,
    filters = {},
    includeStats = false,
  } = {}) {
    const currentPath = normalizeFolderPath(folderPath);
    const filePayload = this.list({
      limit,
      cursor,
      filters: {
        ...filters,
        folderPath: currentPath,
      },
      includeStats,
    });

    const folders = this.listChildFolders(currentPath, filters);
    const searchTerm = String(filters.search || '').trim().toLowerCase();
    const filteredFolders = searchTerm
      ? folders.filter((folder) => folder.name.toLowerCase().includes(searchTerm))
      : folders;

    return {
      currentPath,
      breadcrumbs: this.buildBreadcrumbs(currentPath),
      folders: filteredFolders,
      files: filePayload.keys,
      cursor: filePayload.cursor,
      list_complete: filePayload.list_complete,
      pageCount: filePayload.pageCount,
      stats: filePayload.stats,
    };
  }

  buildBreadcrumbs(pathValue) {
    const path = normalizeFolderPath(pathValue);
    if (!path) return [{ path: '', name: 'All Files' }];

    const breadcrumbs = [{ path: '', name: 'All Files' }];
    const parts = path.split('/');
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      breadcrumbs.push({ path: current, name: part });
    }
    return breadcrumbs;
  }

  listChildFolders(parentPathValue, filters = {}) {
    const parentPath = normalizeFolderPath(parentPathValue);
    const allPaths = this.collectFolderPathSet(filters);
    const fileCountMap = this.buildFolderFileCountMap(filters);
    const folders = [];

    for (const path of allPaths) {
      if (getFolderParent(path) !== parentPath) continue;
      folders.push({
        path,
        name: getFolderName(path),
        parentPath,
        fileCount: fileCountMap.get(path) || 0,
      });
    }

    return folders.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }

  listFolderTree(filters = {}) {
    const pathSet = this.collectFolderPathSet(filters);
    const fileCountMap = this.buildFolderFileCountMap(filters);

    const parentChildrenMap = new Map();
    for (const path of pathSet) {
      const parentPath = getFolderParent(path);
      if (!parentChildrenMap.has(parentPath)) {
        parentChildrenMap.set(parentPath, new Set());
      }
      parentChildrenMap.get(parentPath).add(path);
    }

    const nodes = [{
      path: '',
      name: 'All Files',
      parentPath: '',
      childCount: (parentChildrenMap.get('') || new Set()).size,
      fileCount: fileCountMap.get('') || 0,
    }];

    for (const path of Array.from(pathSet).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))) {
      nodes.push({
        path,
        name: getFolderName(path),
        parentPath: getFolderParent(path),
        childCount: (parentChildrenMap.get(path) || new Set()).size,
        fileCount: fileCountMap.get(path) || 0,
      });
    }

    return nodes;
  }

  collectFolderPathSet(filters = {}) {
    const paths = new Set();

    const storageClause = this.buildStorageClause(filters.storageType);
    const fileFolderRows = all(
      this.db,
      `SELECT DISTINCT folder_path FROM files ${storageClause.whereClause}`,
      storageClause.params
    );
    for (const row of fileFolderRows) {
      const path = normalizeFolderPath(row.folder_path);
      if (!path) continue;
      buildAncestors(path).forEach((ancestor) => paths.add(ancestor));
    }

    const folderRows = all(this.db, `SELECT path FROM virtual_folders ORDER BY path ASC`);
    for (const row of folderRows) {
      const path = normalizeFolderPath(row.path);
      if (!path) continue;
      buildAncestors(path).forEach((ancestor) => paths.add(ancestor));
    }

    return paths;
  }

  buildFolderFileCountMap(filters = {}) {
    const map = new Map();
    const storageClause = this.buildStorageClause(filters.storageType);
    const rows = all(
      this.db,
      `SELECT folder_path, COUNT(1) AS c
       FROM files ${storageClause.whereClause}
       GROUP BY folder_path`,
      storageClause.params
    );
    for (const row of rows) {
      map.set(normalizeFolderPath(row.folder_path), Number(row.c || 0));
    }
    return map;
  }

  buildStorageClause(storageType) {
    if (storageType && storageType !== 'all') {
      return {
        whereClause: 'WHERE storage_type = ?',
        params: [String(storageType)],
      };
    }
    return { whereClause: '', params: [] };
  }

  buildStats(filters = {}) {
    const statsFilters = { ...filters };
    delete statsFilters.folderPath;
    delete statsFilters.folderPrefix;
    const { whereClause, params } = this.buildWhere(statsFilters);
    const rows = all(this.db, `SELECT storage_type, file_name FROM files ${whereClause}`, params);

    const byType = { image: 0, video: 0, audio: 0, document: 0 };
    const byStorage = {
      telegram: 0,
      r2: 0,
      s3: 0,
      discord: 0,
      huggingface: 0,
      webdav: 0,
      github: 0,
    };

    rows.forEach((row) => {
      const ext = String(row.file_name || '').split('.').pop().toLowerCase();
      const type = inferFileType(ext);
      byType[type] += 1;
      if (Object.prototype.hasOwnProperty.call(byStorage, row.storage_type)) {
        byStorage[row.storage_type] += 1;
      }
    });

    return {
      total: rows.length,
      byType,
      byStorage,
    };
  }

  buildWhere(filters = {}) {
    const clauses = [];
    const params = [];

    if (filters.search) {
      clauses.push('(LOWER(file_name) LIKE ? OR LOWER(id) LIKE ?)');
      const term = `%${String(filters.search).toLowerCase()}%`;
      params.push(term, term);
    }

    if (filters.storageType && filters.storageType !== 'all') {
      clauses.push('storage_type = ?');
      params.push(String(filters.storageType));
    }

    if (filters.listType && filters.listType !== 'all') {
      clauses.push('list_type = ?');
      params.push(String(filters.listType));
    }

    if (Object.prototype.hasOwnProperty.call(filters, 'folderPath')) {
      clauses.push('folder_path = ?');
      params.push(normalizeFolderPath(filters.folderPath));
    } else if (filters.folderPrefix) {
      const prefix = normalizeFolderPath(filters.folderPrefix);
      if (prefix) {
        clauses.push('(folder_path = ? OR folder_path LIKE ?)');
        params.push(prefix, `${prefix}/%`);
      }
    }

    return {
      whereClause: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
      params,
    };
  }
}

function inferFileType(ext) {
  const image = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'ico', 'svg', 'heic', 'heif', 'avif']);
  const video = new Set(['mp4', 'webm', 'ogg', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'm4v', '3gp', 'ts']);
  const audio = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'ape', 'opus']);

  if (image.has(ext)) return 'image';
  if (video.has(ext)) return 'video';
  if (audio.has(ext)) return 'audio';
  return 'document';
}

module.exports = {
  FileRepository,
  inferFileType,
  normalizeFolderPath,
};
