const KVaultR2Multipart = (() => {
  const endpoint = '/api/admin/r2-multipart';
  const active = new Set();
  const memory = new Map();

  function checkpointKey(file, folderPath) {
    return 'kvault:r2-multipart:' + JSON.stringify([file.name, file.size, file.lastModified, file.type, folderPath]);
  }

  function loadCheckpoint(key) {
    if (memory.has(key)) return memory.get(key);
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (typeof saved?.session === 'string' && Number.isSafeInteger(saved.partSize) &&
          saved.partSize > 0 && Array.isArray(saved.parts)) return saved;
    } catch { /* storage can be disabled or contain an unreadable checkpoint */ }
    return null;
  }

  function saveCheckpoint(key, checkpoint) {
    try {
      if (checkpoint) localStorage.setItem(key, JSON.stringify(checkpoint));
      else localStorage.removeItem(key);
      memory.delete(key);
    } catch {
      // The same page can still pause and retry when browser storage is unavailable.
      memory.set(key, checkpoint);
    }
  }

  async function withCheckpoint(key, action) {
    const busy = () => new Error('此文件已在另一个上传任务中。');
    if (active.has(key)) throw busy();
    active.add(key);
    try {
      const locks = globalThis.navigator?.locks;
      if (locks) {
        return await locks.request(key, { ifAvailable: true }, lock => {
          if (!lock) throw busy();
          return action();
        });
      }
      return await action();
    } finally {
      active.delete(key);
    }
  }

  async function request(url, { method, session, json, body, signal, retry = false }) {
    const headers = {};
    if (session) headers['X-Upload-Session'] = session;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      let response;
      let error;
      try {
        response = await fetch(url, { method, headers, body, signal, credentials: 'same-origin' });
        const result = await response.json().catch(() => null);
        if (response.ok && result?.success) return result;
        error = new Error(result?.error?.message || `R2 上传请求失败（HTTP ${response.status}）。`);
        error.code = result?.error?.code;
      } catch (networkError) {
        error = networkError;
      }
      if (signal?.aborted || !retry || attempt >= 2 ||
          (response && response.status < 500 && response.status !== 429)) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }

  async function partDigest(part) {
    const digest = await crypto.subtle.digest('SHA-256', await part.arrayBuffer());
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function sendParts(file, key, checkpoint, signal, onProgress) {
    const { session, partSize, parts } = checkpoint;
    const count = Math.ceil(file.size / partSize);
    for (let index = 0; index < count; index++) {
      signal?.throwIfAborted();
      const chunk = file.slice(index * partSize, (index + 1) * partSize);
      const digest = await partDigest(chunk);
      if (parts[index]) {
        if (parts[index].digest !== digest) throw new Error('文件内容与断点不一致。请放弃旧断点后重试。');
      } else {
        const result = await request(`${endpoint}?part=${index + 1}`, {
          method: 'PUT', session, body: chunk, signal, retry: true,
        });
        if (result.src) return result.src;
        if (result.part?.partNumber !== index + 1 || !result.part.etag) throw new Error('R2 未返回有效的分片回执。');
        parts[index] = { ...result.part, digest };
        saveCheckpoint(key, checkpoint);
      }
      onProgress(Math.round(((index + 1) / count) * 95));
    }
    const completed = await request(`${endpoint}?action=complete`, {
      method: 'POST', session, json: { parts: parts.map(({ partNumber, etag }) => ({ partNumber, etag })) },
      signal, retry: true,
    });
    if (!completed.src) throw new Error('R2 未返回完成链接。');
    return completed.src;
  }

  function upload(file, folderPath, { signal, onProgress = () => {} } = {}) {
    const key = checkpointKey(file, folderPath);
    return withCheckpoint(key, async () => {
      if (!globalThis.crypto?.subtle) throw new Error('请在 HTTPS 或本地预览中使用 R2 续传。');
      let checkpoint = loadCheckpoint(key);
      for (let recovery = 0; ; recovery++) {
        if (!checkpoint) {
          const started = await request(endpoint, {
            method: 'POST', signal,
            json: { fileName: file.name, fileSize: file.size, fileType: file.type, folderPath },
          });
          if (typeof started.session !== 'string' || !started.session ||
              !Number.isSafeInteger(started.partSize) || started.partSize < 1) {
            throw new Error('R2 未返回有效的上传会话。');
          }
          checkpoint = { session: started.session, partSize: started.partSize, parts: [] };
          saveCheckpoint(key, checkpoint);
        }
        try {
          const src = await sendParts(file, key, checkpoint, signal, onProgress);
          saveCheckpoint(key, null);
          return src;
        } catch (error) {
          if (signal?.aborted || recovery >= 1) throw error;
          if (error.code === 'STALE_PARTS') {
            checkpoint.parts = [];
          } else if (['EXPIRED_SESSION', 'INVALID_SESSION'].includes(error.code)) {
            checkpoint = null;
          } else {
            throw error;
          }
          saveCheckpoint(key, checkpoint);
          onProgress(0);
        }
      }
    });
  }

  function discard(file, folderPath) {
    const key = checkpointKey(file, folderPath);
    return withCheckpoint(key, async () => {
      const checkpoint = loadCheckpoint(key);
      let result;
      if (checkpoint) {
        try {
          result = await request(endpoint, { method: 'DELETE', session: checkpoint.session, retry: true });
        } catch (error) {
          if (error.code !== 'INVALID_SESSION') throw error;
          // A rotated credential invalidates the checkpoint. R2 lifecycle handles the remaining upload.
        }
      }
      saveCheckpoint(key, null);
      return result?.src;
    });
  }

  return { upload, discard };
})();

if (typeof module === 'object' && module.exports) module.exports = KVaultR2Multipart;
