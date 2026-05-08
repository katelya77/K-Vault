/**
 * Debug 工具函数
 * 用于在开发模式下输出详细的调试信息
 * 注意：只在 DEBUG=true 时才输出日志，避免在生产环境中产生不必要的日志
 */

/**
 * 检查是否启用 debug 模式
 * @param {Object} env - 环境变量对象
 * @returns {boolean}
 */
export function isDebugEnabled(env) {
  const value = env?.DEBUG;
  if (value === undefined || value === null) {
    return false;
  }
  return value === 'true' || value === '1' || value === true;
}

/**
 * 输出 debug 日志
 * @param {Object} env - 环境变量对象
 * @param {string} category - 日志类别
 * @param {string} message - 日志消息
 * @param {any} data - 附加数据（可选）
 */
export function debugLog(env, category, message, data = null) {
  if (!isDebugEnabled(env)) {
    return;
  }

  const timestamp = new Date().toISOString();
  const prefix = `[DEBUG][${timestamp}][${category}]`;
  
  if (data !== null && data !== undefined) {
    console.debug(prefix, message, data);
  } else {
    console.debug(prefix, message);
  }
}

/**
 * 输出 debug 错误
 * @param {Object} env - 环境变量对象
 * @param {string} category - 日志类别
 * @param {string} message - 错误消息
 * @param {Error} error - 错误对象（可选）
 */
export function debugError(env, category, message, error = null) {
  if (!isDebugEnabled(env)) {
    return;
  }

  const timestamp = new Date().toISOString();
  const prefix = `[DEBUG][${timestamp}][${category}]`;
  
  if (error !== null && error !== undefined) {
    console.debug(prefix, message, error);
  } else {
    console.debug(prefix, message);
  }
}

/**
 * 输出 debug 警告
 * @param {Object} env - 环境变量对象
 * @param {string} category - 日志类别
 * @param {string} message - 警告消息
 * @param {any} data - 附加数据（可选）
 */
export function debugWarn(env, category, message, data = null) {
  if (!isDebugEnabled(env)) {
    return;
  }

  const timestamp = new Date().toISOString();
  const prefix = `[DEBUG][${timestamp}][${category}]`;
  
  if (data !== null && data !== undefined) {
    console.debug(prefix, 'WARNING:', message, data);
  } else {
    console.debug(prefix, 'WARNING:', message);
  }
}

/**
 * 输出 debug 信息
 * @param {Object} env - 环境变量对象
 * @param {string} category - 日志类别
 * @param {string} message - 信息消息
 * @param {any} data - 附加数据（可选）
 */
export function debugInfo(env, category, message, data = null) {
  if (!isDebugEnabled(env)) {
    return;
  }

  const timestamp = new Date().toISOString();
  const prefix = `[DEBUG][${timestamp}][${category}]`;
  
  if (data !== null && data !== undefined) {
    console.debug(prefix, 'INFO:', message, data);
  } else {
    console.debug(prefix, 'INFO:', message);
  }
}
