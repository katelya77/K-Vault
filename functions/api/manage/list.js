/**
 * 文件列表 API - 基于数据库实现
 * 支持高效分页和多维度查询
 */

import { FileRepository } from '../../../server/lib/db/repository.js';

function parsePositiveInt(value, defaultValue, min = 1, max = 1000) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeSortBy(value) {
  const validFields = {
    'time': 'created_at',
    'created_at': 'created_at',
    'size': 'file_size',
    'file_size': 'file_size',
    'name': 'file_name',
    'file_name': 'file_name'
  };
  return validFields[String(value || '').toLowerCase()] || 'created_at';
}

function normalizeSortOrder(value) {
  const order = String(value || '').toUpperCase();
  return order === 'ASC' ? 'ASC' : 'DESC';
}

function buildFileUrl(file, env) {
  const baseUrl = env.PUBLIC_BASE_URL || '';
  const prefix = baseUrl ? '' : '/file/';
  return `${baseUrl}${prefix}${file.storage_key}`;
}

function formatFileResponse(file, env) {
  return {
    id: file.id,
    name: file.storage_key,
    src: buildFileUrl(file, env),
    fileName: file.file_name,
    size: file.file_size,
    time: file.created_at,
    type: file.mime_type,
    storageType: file.storage_type,
    folderId: file.folder_id,
    folderPath: file.folder_path,
    liked: Boolean(file.liked),
    listType: file.list_type,
    label: file.label,
    extra: file.extra_json ? JSON.parse(file.extra_json) : {}
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  try {
    const fileRepo = new FileRepository(env.DB, env);

    const page = parsePositiveInt(url.searchParams.get('page'), 1, 1, 10000);
    const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 20, 1, 200);
    const storageType = url.searchParams.get('storage') || url.searchParams.get('storageType');
    const folderId = url.searchParams.get('folderId') || url.searchParams.get('folder');
    const folderPath = url.searchParams.get('folderPath');
    const liked = url.searchParams.get('liked');
    const listType = url.searchParams.get('listType');
    const sortBy = normalizeSortBy(url.searchParams.get('sort') || url.searchParams.get('sortBy'));
    const sortOrder = normalizeSortOrder(url.searchParams.get('order') || url.searchParams.get('sortOrder'));
    const search = url.searchParams.get('search') || url.searchParams.get('q');

    let result;

    if (search) {
      result = await fileRepo.search(search, { page, pageSize });
    } else {
      const options = {
        page,
        pageSize,
        sortBy,
        sortOrder
      };

      if (folderId) {
        options.folderId = folderId;
      } else if (folderPath) {
        const folder = await env.DB.prepare(
          'SELECT id FROM folders WHERE path = ?'
        ).bind(folderPath).first();
        
        if (folder) {
          options.folderId = folder.id;
        }
      }

      if (storageType) {
        options.storageType = storageType;
      }

      if (listType) {
        options.listType = listType;
      }

      if (liked !== null && liked !== undefined) {
        options.liked = liked === 'true' || liked === '1';
      }

      result = await fileRepo.list(options);
    }

    const files = result.items.map(file => formatFileResponse(file, env));

    return new Response(JSON.stringify({
      success: true,
      result: files,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('List files error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      errorCode: 'LIST_ERROR'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
