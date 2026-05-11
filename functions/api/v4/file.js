import { buildTelegramBotApiUrl } from '../../utils/telegram.js';

function cloudreveSuccess(data) {
  return new Response(JSON.stringify({ code: 0, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function errorResponse(msg, status = 400) {
  return new Response(JSON.stringify({ code: status, msg, error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fmtTime(ts) {
  if (!ts) return new Date().toISOString();
  return new Date(Number(ts)).toISOString();
}

function parseCloudreveUri(uri) {
  if (!uri || uri === '/') return { isRoot: true, fs: 'my', path: '' };
  if (!uri.startsWith('cloudreve://')) return { isRoot: uri === '/', fs: 'my', path: uri === '/' ? '' : uri.replace(/\/+$/, '') };
  const rest = uri.slice('cloudreve://'.length);
  const idx = rest.indexOf('/');
  if (idx === -1) return { isRoot: true, fs: rest, path: '' };
  return { isRoot: false, fs: rest.slice(0, idx), path: rest.slice(idx).replace(/\/+$/, '') };
}

function displayName(uri) {
  if (!uri || uri === '/' || uri === 'cloudreve://my') return '我的文件';
  const parsed = parseCloudreveUri(uri);
  if (parsed.isRoot) return '我的文件';
  const parts = parsed.path.split('/').filter(Boolean);
  return parts.pop() || '我的文件';
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const uri = url.searchParams.get('uri') || 'cloudreve://my';
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = parseInt(url.searchParams.get('page_size') || '50');

  if (!env.DB) {
    return cloudreveSuccess({
      files: [],
      pagination: { page, page_size: pageSize, total: 0 },
      props: { max_page_size: 100, order_by_options: ['created_at'], order_direction_options: ['desc'] },
      parent: null,
    });
  }

  try {
    const parsed = parseCloudreveUri(uri);
    const isTrash = parsed.fs === 'trash';
    const folderPath = parsed.path;

    if (isTrash) {
      const colCheck = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM pragma_table_info('files') WHERE name='deleted_at'"
      ).first();
      if (!colCheck || !colCheck.count) {
        return errorResponse('回收站功能不可用，请先执行数据库迁移', 400);
      }
    }

    const countResult = await env.DB.prepare(
      isTrash
        ? 'SELECT COUNT(*) as count FROM files WHERE deleted_at IS NOT NULL'
        : 'SELECT COUNT(*) as count FROM files WHERE folder_path = ? AND deleted_at IS NULL'
    ).bind(...(isTrash ? [] : [folderPath])).first();
    const total = countResult?.count || 0;

    const offset = (page - 1) * pageSize;
    const fileRows = await env.DB.prepare(
      isTrash
        ? 'SELECT id, file_name, folder_path, file_size, created_at, updated_at, deleted_at, storage_type, storage_file_id FROM files WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT ? OFFSET ?'
        : 'SELECT id, file_name, folder_path, file_size, created_at, updated_at FROM files WHERE folder_path = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).bind(...(isTrash ? [pageSize, offset] : [folderPath, pageSize, offset])).all();

    const files = (fileRows.results || []).map(row => ({
      id: row.id,
      name: row.file_name,
      type: 0,
      path: isTrash
        ? row.folder_path
          ? 'cloudreve://my' + '/' + row.folder_path.replace(/^\//, '') + '/' + row.file_name
          : 'cloudreve://my/' + row.file_name
        : 'cloudreve://my' + (row.folder_path ? '/' + row.folder_path.replace(/^\//, '') + '/' : '/') + row.file_name,
      size: row.file_size,
      created_at: fmtTime(row.created_at),
      updated_at: fmtTime(row.deleted_at || row.updated_at),
      owned: true,
      capability: isTrash ? 'wUKC' : 'wUKA',
      ...(isTrash ? { metadata: { restore_uri: row.folder_path || '/' } } : {}),
    }));

    let folders = [];
    let parentRow = null;

    if (!isTrash) {
      parentRow = await env.DB.prepare(
        "SELECT id, name, path, created_at, updated_at FROM folders WHERE path = ? LIMIT 1"
      ).bind(folderPath || '/').first();

      const folderRows = await env.DB.prepare(
        "SELECT id, name, path, created_at, updated_at FROM folders WHERE parent_id = ? ORDER BY name ASC"
      ).bind(parentRow?.id || '').all();

      folders = (folderRows.results || []).map(row => ({
        id: row.id,
        name: row.name,
        type: 1,
        path: 'cloudreve://my' + (row.path === '/' ? '' : row.path),
        size: 0,
        created_at: fmtTime(row.created_at),
        updated_at: fmtTime(row.updated_at),
        owned: true,
        capability: 'wUKA',
      }));
    }

    return cloudreveSuccess({
      files: [...folders, ...files],
      pagination: {
        page,
        page_size: pageSize,
        total: total + (folders?.length || 0),
      },
      props: {
        root_uri: isTrash ? 'cloudreve://trash' : 'cloudreve://my',
        root_name: isTrash ? '回收站' : '我的文件',
        max_page_size: 100,
        order_by_options: isTrash ? ['deleted_at'] : ['created_at', 'updated_at', 'name', 'size'],
        order_direction_options: ['desc'],
      },
      parent: isTrash ? null : {
        id: parentRow?.id || 'root',
        name: displayName(uri),
        type: 1,
        path: uri,
        created_at: parentRow ? fmtTime(parentRow.created_at) : new Date().toISOString(),
        updated_at: parentRow ? fmtTime(parentRow.updated_at) : new Date().toISOString(),
        size: 0,
        owned: true,
        capability: 'wUKA',
      },
      storage_policy: {
        id: 'default',
        name: 'Default Storage',
        type: 'local',
        max_size: 11544872091648,
      },
    });
  } catch (error) {
    return cloudreveSuccess({
      files: [],
      pagination: { page, page_size: pageSize, total: 0 },
      props: {
        max_page_size: 100,
        order_by_options: ['created_at'],
        order_direction_options: ['desc'],
      },
      parent: null,
    });
  }
}

export async function onRequestDelete(context) {
  const { env, request } = context;

  if (!env.DB) {
    return cloudreveSuccess({ deleted: 0 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('无效的请求体', 400);
  }

  const uris = body?.uris || [];
  if (!Array.isArray(uris) || uris.length === 0) {
    return errorResponse('缺少待删除文件列表', 400);
  }

  const skipSoftDelete = body?.skip_soft_delete === true;
  const now = Date.now();
  let deletedCount = 0;

  for (const uri of uris) {
    const parsed = parseCloudreveUri(uri);
    const pathParts = parsed.path.split('/').filter(Boolean);
    if (pathParts.length === 0) continue;

    const fileName = pathParts.pop();
    const folderPath = pathParts.length === 0 ? '/' : '/' + pathParts.join('/');

    try {
      if (skipSoftDelete) {
        const row = await env.DB.prepare(
          folderPath === '/'
            ? 'SELECT id, user_id, file_size, storage_type, storage_file_id, extra_json, deleted_at FROM files WHERE file_name = ? AND (folder_path = ? OR folder_path = \'\')'
            : 'SELECT id, user_id, file_size, storage_type, storage_file_id, extra_json, deleted_at FROM files WHERE file_name = ? AND folder_path = ?'
        ).bind(fileName, folderPath).first();

        if (!row) continue;

        const wasSoftDeleted = row.deleted_at !== null;
        await deleteFromTargetStorage(env, row);
        await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(row.id).run();
        deletedCount++;
        
        if (!wasSoftDeleted && row.user_id && row.file_size > 0) {
          try {
            await env.DB.prepare(
              "UPDATE users SET storage_used = MAX(0, storage_used - ?) WHERE id = ?"
            ).bind(row.file_size, row.user_id).run();
          } catch (e) {
            console.error('硬删除扣除 storage_used 失败:', e.message);
          }
        }
      } else {
        const row = await env.DB.prepare(
          folderPath === '/'
            ? 'SELECT id, user_id, file_size FROM files WHERE file_name = ? AND (folder_path = ? OR folder_path = \'\') AND deleted_at IS NULL'
            : 'SELECT id, user_id, file_size FROM files WHERE file_name = ? AND folder_path = ? AND deleted_at IS NULL'
        ).bind(fileName, folderPath).first();

        if (!row) continue;

        const result = await env.DB.prepare(
          folderPath === '/'
            ? 'UPDATE files SET deleted_at = ? WHERE id = ?'
            : 'UPDATE files SET deleted_at = ? WHERE id = ?'
        ).bind(now, row.id).run();

        if (result.meta.changes > 0) {
          deletedCount++;
          if (row.user_id && row.file_size > 0) {
            try {
              await env.DB.prepare(
                "UPDATE users SET storage_used = MAX(0, storage_used - ?) WHERE id = ?"
              ).bind(row.file_size, row.user_id).run();
            } catch (e) {
              console.error('扣除 storage_used 失败:', e.message);
            }
          }
        }
      }
    } catch (e) {
      console.error('删除文件失败:', uri, e.message);
    }
  }

  return cloudreveSuccess({ deleted: deletedCount });
}

async function deleteFromTargetStorage(env, row) {
  const type = row.storage_type;
  const extraJson = row.extra_json || '{}';

  try {
    if (type === 'telegram') {
      const extra = JSON.parse(extraJson);
      const messageId = extra.telegramMessageId;
      if (messageId && env.TG_Bot_Token && env.TG_Chat_ID) {
        await fetch(buildTelegramBotApiUrl(env, 'deleteMessage'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: env.TG_Chat_ID, message_id: messageId }),
        });
      }
    }
  } catch (e) {
    console.error('删除目标存储文件失败:', type, e.message);
  }
}
