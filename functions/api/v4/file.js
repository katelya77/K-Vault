function cloudreveSuccess(data) {
  return new Response(JSON.stringify({ code: 0, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
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
    const folderPath = parsed.path;

    const countResult = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM files WHERE folder_path = ?'
    ).bind(folderPath).first();
    const total = countResult?.count || 0;

    const offset = (page - 1) * pageSize;
    const fileRows = await env.DB.prepare(
      'SELECT * FROM files WHERE folder_path = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).bind(folderPath, pageSize, offset).all();

    const files = (fileRows.results || []).map(row => ({
      id: row.id,
      name: row.file_name,
      type: 0,
      path: 'cloudreve://my' + (row.folder_path ? '/' + row.folder_path.replace(/^\//, '') + '/' : '/') + row.file_name,
      size: row.file_size,
      created_at: fmtTime(row.created_at),
      updated_at: fmtTime(row.updated_at),
      owned: true,
      capability: 'wUKA',
    }));

    const parentRow = await env.DB.prepare(
      "SELECT id, name, path, created_at, updated_at FROM folders WHERE path = ? LIMIT 1"
    ).bind(folderPath || '/').first();

    const folderRows = await env.DB.prepare(
      "SELECT * FROM folders WHERE parent_id = ? ORDER BY name ASC"
    ).bind(parentRow?.id || '').all();

    const folders = (folderRows.results || []).map(row => ({
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

    return cloudreveSuccess({
      files: [...folders, ...files],
      pagination: {
        page,
        page_size: pageSize,
        total: total + (folderRows.results?.length || 0),
      },
      props: {
        root_uri: 'cloudreve://my',
        root_name: '我的文件',
        max_page_size: 100,
        order_by_options: ['created_at', 'updated_at', 'name', 'size'],
        order_direction_options: ['asc', 'desc'],
      },
      parent: {
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
