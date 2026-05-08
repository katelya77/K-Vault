/**
 * 文件名混淆工具
 * 用于生成随机文件名，防止敏感文件触发第三方平台的自动封禁
 */

import { debugLog, debugError } from './debug.js';

/**
 * 生成随机 UUID v4
 * @param {Object} env - 环境变量对象（可选）
 * @returns {string} UUID 字符串
 */
export function generateUUID(env = null) {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      const uuid = crypto.randomUUID();
      if (env) debugLog(env, 'OBFUSCATE', 'Generated UUID', { uuid });
      return uuid;
    }
    
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    
    const hex = [];
    for (let i = 0; i < 16; i += 1) {
      hex.push(bytes[i].toString(16).padStart(2, '0'));
    }
    
    const uuid = `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`;
    if (env) debugLog(env, 'OBFUSCATE', 'Generated UUID (fallback)', { uuid });
    return uuid;
  } catch (error) {
    if (env) debugError(env, 'OBFUSCATE', 'UUID generation failed', error);
    throw error;
  }
}

/**
 * 生成 SHA-256 哈希值
 * @param {string} input - 输入字符串
 * @param {Object} env - 环境变量对象（可选）
 * @returns {Promise<string>} SHA-256 哈希值（十六进制）
 */
export async function generateSHA256(input, env = null) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    if (env) debugLog(env, 'OBFUSCATE', 'Generated SHA-256 hash', { input: input.substring(0, 50), hashHex: hashHex.substring(0, 16) + '...' });
    return hashHex;
  } catch (error) {
    if (env) debugError(env, 'OBFUSCATE', 'SHA-256 generation failed', error);
    console.error('SHA-256 generation failed:', error);
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2);
    const fallback = `${timestamp}${random}`.replace(/[^a-z0-9]/g, '').substring(0, 64);
    if (env) debugLog(env, 'OBFUSCATE', 'Using fallback hash', { fallback });
    return fallback;
  }
}

/**
 * 混淆文件名
 * @param {string} originalFileName - 原始文件名
 * @param {Object} options - 配置选项
 * @param {string} options.method - 混淆方法：'uuid' 或 'sha256'
 * @param {string} options.extension - 强制后缀名：'.data'、'.bin' 等
 * @param {Object} options.env - 环境变量对象（可选）
 * @returns {Promise<{physicalFileName: string, originalFileName: string}>}
 */
export async function obfuscateFileName(originalFileName, options = {}) {
  const {
    method = 'uuid',
    extension = '.data',
    env = null
  } = options;

  if (env) debugLog(env, 'OBFUSCATE', 'Starting file name obfuscation', { originalFileName, method, extension });

  let baseName;
  
  if (method === 'sha256') {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2);
    baseName = await generateSHA256(`${originalFileName}-${timestamp}-${random}`, env);
  } else {
    baseName = generateUUID(env).replace(/-/g, '');
  }

  const physicalFileName = `${baseName}${extension}`;

  if (env) debugLog(env, 'OBFUSCATE', 'File name obfuscated', { originalFileName, physicalFileName });

  return {
    physicalFileName,
    originalFileName
  };
}

/**
 * 检查是否启用文件名混淆
 * @param {Object} env - 环境变量对象
 * @returns {boolean}
 */
export function isFileNameObfuscationEnabled(env) {
  const value = env?.OBFUSCATE_FILE_NAMES;
  if (value === undefined || value === null) {
    return false;
  }
  return value === 'true' || value === '1' || value === true;
}

/**
 * 获取混淆配置
 * @param {Object} env - 环境变量对象
 * @returns {Object}
 */
export function getObfuscationConfig(env) {
  return {
    enabled: isFileNameObfuscationEnabled(env),
    method: env?.OBFUSCATE_METHOD || 'uuid',
    extension: env?.OBFUSCATE_EXTENSION || '.bin'
  };
}

/**
 * 获取文件的 MIME 类型
 * @param {string} fileName - 文件名
 * @returns {string}
 */
export function getMimeType(fileName) {
  const ext = String(fileName).split('.').pop()?.toLowerCase() || '';
  
  const mimeTypes = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogg: 'video/ogg',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    m4v: 'video/x-m4v',
    wmv: 'video/x-ms-wmv',
    flv: 'video/x-flv',
    '3gp': 'video/3gpp',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    aac: 'audio/aac',
    m4a: 'audio/mp4',
    wma: 'audio/x-ms-wma',
    opus: 'audio/opus',
    oga: 'audio/ogg',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    html: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    json: 'application/json',
    xml: 'application/xml',
    md: 'text/markdown',
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    tar: 'application/x-tar',
    gz: 'application/gzip'
  };

  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * 生成 Content-Disposition 响应头
 * @param {string} fileName - 文件名
 * @param {string} disposition - 处置类型：'inline' 或 'attachment'
 * @returns {string}
 */
export function generateContentDisposition(fileName, disposition = 'inline') {
  const encodedFileName = encodeURIComponent(fileName);
  return `${disposition}; filename*=UTF-8''${encodedFileName}`;
}
