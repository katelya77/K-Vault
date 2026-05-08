/**
 * R2 文件上传 API
 * 将文件直接存储到 Cloudflare R2
 */

import { createStorageManager, generateKey, getFileType } from '../../utils/storage.js';
import {
  obfuscateFileName,
  getObfuscationConfig,
} from '../../utils/obfuscate.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  
  // 检查 R2 是否可用
  if (!env.R2_BUCKET) {
    return new Response(JSON.stringify({
      error: 'R2 storage not configured'
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    
    if (!file) {
      return new Response(JSON.stringify({
        error: 'No file provided'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 文件名混淆
    const obfuscationConfig = getObfuscationConfig(env);
    let actualFileName = file.name;
    let physicalFileName = null;
    
    if (obfuscationConfig.enabled) {
      const obfuscated = await obfuscateFileName(file.name, obfuscationConfig);
      physicalFileName = obfuscated.physicalFileName;
      actualFileName = physicalFileName;
    }
    
    // 生成文件 ID
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 10);
    const ext = file.name.split('.').pop() || '';
    const fileId = `${timestamp}_${randomStr}${ext ? '.' + ext : ''}`;
    
    // 获取文件内容
    const content = await file.arrayBuffer();
    
    // 存储到 R2
    await env.R2_BUCKET.put(fileId, content, {
      httpMetadata: {
        contentType: file.type || 'application/octet-stream'
      },
      customMetadata: {
        fileName: obfuscationConfig.enabled ? actualFileName : file.name,
        fileSize: String(file.size),
        uploadTime: String(timestamp),
        fileType: getFileType(file.name)
      }
    });
    
    // 同时在 KV 中存储元数据（用于管理和列表）
    if (env.img_url) {
      const key = generateKey(fileId, file.name);
      await env.img_url.put(key, '', {
        metadata: {
          fileName: file.name,
          physicalFileName,
          fileSize: file.size,
          TimeStamp: timestamp,
          storage: 'r2',
          contentType: file.type || 'application/octet-stream'
        }
      });
    }
    
    // 返回成功响应
    return new Response(JSON.stringify([{
      src: `/file/${fileId}`,
      storage: 'r2'
    }]), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('R2 upload error:', error);
    return new Response(JSON.stringify({
      error: error.message || 'Upload failed'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * 获取 R2 文件
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  
  if (!env.R2_BUCKET) {
    return new Response('R2 storage not configured', { status: 503 });
  }
  
  const url = new URL(request.url);
  const fileId = url.searchParams.get('id');
  
  if (!fileId) {
    return new Response('File ID required', { status: 400 });
  }
  
  try {
    const object = await env.R2_BUCKET.get(fileId);
    
    if (!object) {
      return new Response('File not found', { status: 404 });
    }
    
    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Content-Length', object.size);
    
    if (object.customMetadata?.fileName) {
      headers.set('Content-Disposition', `inline; filename="${object.customMetadata.fileName}"`);
    }
    
    // 缓存控制
    headers.set('Cache-Control', 'public, max-age=31536000');
    
    return new Response(object.body, { headers });
    
  } catch (error) {
    console.error('R2 get error:', error);
    return new Response('Error retrieving file', { status: 500 });
  }
}
