/**
 * 文件夹管理 API - 基于数据库实现
 * 支持无限级文件夹层级
 */

import { FolderRepository, FileRepository } from '../../../server/lib/db/repository.js';

function normalizePath(value = '') {
  const raw = String(value || '').replace(/\\/g, '/').trim();
  const output = [];
  for (const part of raw.split('/')) {
    const piece = part.trim();
    if (!piece || piece === '.') continue;
    if (piece === '..') {
      output.pop();
      continue;
    }
    output.push(piece);
  }
  return output.join('/');
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  try {
    const folderRepo = new FolderRepository(env.DB);
    const fileRepo = new FileRepository(env.DB);

    const parentId = url.searchParams.get('parentId');
    const path = url.searchParams.get('path');

    if (path) {
      const folder = await folderRepo.findByPath(normalizePath(path));
      if (!folder) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Folder not found',
          errorCode: 'FOLDER_NOT_FOUND'
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const [subfolders, files] = await Promise.all([
        folderRepo.findByParentId(folder.id),
        fileRepo.list({ folderId: folder.id, pageSize: 1000 })
      ]);

      return new Response(JSON.stringify({
        success: true,
        result: {
          folder: {
            id: folder.id,
            name: folder.name,
            path: folder.path,
            parentId: folder.parent_id,
            createdAt: folder.created_at,
            updatedAt: folder.updated_at
          },
          subfolders: subfolders.map(f => ({
            id: f.id,
            name: f.name,
            path: f.path,
            parentId: f.parent_id,
            fileCount: 0
          })),
          files: files.items.map(f => ({
            id: f.id,
            name: f.file_name,
            size: f.file_size,
            type: f.mime_type,
            storageType: f.storage_type
          }))
        }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const folders = await folderRepo.findByParentId(parentId || null);

    const foldersWithCount = await Promise.all(
      folders.map(async (folder) => {
        const count = await fileRepo.count({ folderId: folder.id });
        return {
          id: folder.id,
          name: folder.name,
          path: folder.path,
          parentId: folder.parent_id,
          fileCount: count,
          createdAt: folder.created_at,
          updatedAt: folder.updated_at
        };
      })
    );

    return new Response(JSON.stringify({
      success: true,
      result: foldersWithCount
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Get folders error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      errorCode: 'GET_FOLDERS_ERROR'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const folderRepo = new FolderRepository(env.DB);
    const body = await request.json();

    const name = String(body.name || '').trim();
    const parentId = body.parentId || null;
    const parentPath = body.parentPath || '';

    if (!name) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Folder name is required',
        errorCode: 'NAME_REQUIRED'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let path = name;
    if (parentId) {
      const parent = await folderRepo.findById(parentId);
      if (!parent) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Parent folder not found',
          errorCode: 'PARENT_NOT_FOUND'
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      path = `${parent.path}/${name}`;
    } else if (parentPath) {
      path = `${normalizePath(parentPath)}/${name}`;
    }

    const existing = await folderRepo.findByPath(path);
    if (existing) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Folder already exists',
        errorCode: 'FOLDER_EXISTS'
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const folder = await folderRepo.create({
      name,
      parentId,
      path
    });

    return new Response(JSON.stringify({
      success: true,
      result: {
        id: folder.id,
        name: folder.name,
        path: folder.path,
        parentId: folder.parent_id,
        createdAt: folder.created_at,
        updatedAt: folder.updated_at
      }
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Create folder error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      errorCode: 'CREATE_FOLDER_ERROR'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  try {
    const folderRepo = new FolderRepository(env.DB);
    const fileRepo = new FileRepository(env.DB);

    const folderId = url.searchParams.get('id');
    const path = url.searchParams.get('path');

    if (!folderId && !path) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Folder ID or path is required',
        errorCode: 'ID_OR_PATH_REQUIRED'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let folder;
    if (folderId) {
      folder = await folderRepo.findById(folderId);
    } else {
      folder = await folderRepo.findByPath(normalizePath(path));
    }

    if (!folder) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Folder not found',
        errorCode: 'FOLDER_NOT_FOUND'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const fileCount = await fileRepo.count({ folderId: folder.id });
    if (fileCount > 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Folder is not empty',
        errorCode: 'FOLDER_NOT_EMPTY',
        fileCount
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await folderRepo.delete(folder.id);

    return new Response(JSON.stringify({
      success: true,
      message: 'Folder deleted successfully'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Delete folder error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      errorCode: 'DELETE_FOLDER_ERROR'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
