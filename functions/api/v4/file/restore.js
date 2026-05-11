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

function parseCloudreveUri(uri) {
  if (!uri || uri === '/') return { isRoot: true, fs: 'my', path: '' };
  if (!uri.startsWith('cloudreve://')) return { isRoot: uri === '/', fs: 'my', path: uri === '/' ? '' : uri.replace(/\/+$/, '') };
  const rest = uri.slice('cloudreve://'.length);
  const idx = rest.indexOf('/');
  if (idx === -1) return { isRoot: true, fs: rest, path: '' };
  return { isRoot: false, fs: rest.slice(0, idx), path: rest.slice(idx).replace(/\/+$/, '') };
}

export async function onRequestPost(context) {
  const { env, request } = context;

  if (!env.DB) {
    return cloudreveSuccess({ restored: 0 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('无效的请求体', 400);
  }

  const uris = body?.uris || [];
  if (!Array.isArray(uris) || uris.length === 0) {
    return errorResponse('缺少待恢复文件列表', 400);
  }

  const colCheck = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM pragma_table_info('files') WHERE name='deleted_at'"
  ).first();
  if (!colCheck || !colCheck.count) {
    return errorResponse('回收站功能不可用，请先执行数据库迁移', 400);
  }

  let restoredCount = 0;
  for (const uri of uris) {
    const parsed = parseCloudreveUri(uri);
    const pathParts = parsed.path.split('/').filter(Boolean);
    if (pathParts.length === 0) continue;

    const fileName = pathParts.pop();
    const folderPath = pathParts.length === 0 ? '/' : '/' + pathParts.join('/');

    try {
      const row = await env.DB.prepare(
        folderPath === '/'
          ? "SELECT id, user_id, file_size FROM files WHERE file_name = ? AND (folder_path = ? OR folder_path = '') AND deleted_at IS NOT NULL"
          : 'SELECT id, user_id, file_size FROM files WHERE file_name = ? AND folder_path = ? AND deleted_at IS NOT NULL'
      ).bind(fileName, folderPath).first();

      if (!row) continue;

      const result = await env.DB.prepare(
        folderPath === '/'
          ? "UPDATE files SET deleted_at = NULL WHERE file_name = ? AND (folder_path = ? OR folder_path = '') AND deleted_at IS NOT NULL"
          : 'UPDATE files SET deleted_at = NULL WHERE file_name = ? AND folder_path = ? AND deleted_at IS NOT NULL'
      ).bind(fileName, folderPath).run();
      
      if (result.meta.changes > 0) {
        restoredCount++;
        if (row.user_id && row.file_size > 0) {
          try {
            await env.DB.prepare(
              "UPDATE users SET storage_used = storage_used + ? WHERE id = ?"
            ).bind(row.file_size, row.user_id).run();
          } catch (e) {
            console.error('恢复文件加回 storage_used 失败:', e.message);
          }
        }
      }
    } catch (e) {
      console.error('恢复文件失败:', uri, e.message);
    }
  }

  return cloudreveSuccess({ restored: restoredCount });
}
