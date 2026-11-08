/**
 * Per-token policy enforcement (requirement #10).
 * Shared by /api/v1/upload and /api/v1/import.
 */

function baseMime(mime) {
  return String(mime || '').split(';')[0].trim().toLowerCase();
}

export function checkUploadPolicy(tokenRecord, { storage, mime, sizeBytes, folderPath, request }) {
  const policies = tokenRecord?.policies;
  if (!policies) return { ok: true };

  if (policies.allowedStorages?.length) {
    if (!storage || !policies.allowedStorages.includes(storage)) {
      return {
        ok: false,
        status: 403,
        code: 'POLICY_STORAGE_DENIED',
        message: `API Token policy only allows storage: ${policies.allowedStorages.join(', ')}.`,
      };
    }
  }

  if (mime !== undefined && policies.allowedMimeTypes?.length) {
    const normalized = baseMime(mime);
    if (!normalized || !policies.allowedMimeTypes.includes(normalized)) {
      return {
        ok: false,
        status: 403,
        code: 'POLICY_MIME_DENIED',
        message: `API Token policy only allows MIME types: ${policies.allowedMimeTypes.join(', ')}.`,
      };
    }
  }

  if (policies.maxFileSize && Number(sizeBytes) > policies.maxFileSize) {
    return {
      ok: false,
      status: 413,
      code: 'POLICY_SIZE_EXCEEDED',
      message: `API Token policy limits uploads to ${policies.maxFileSize} bytes.`,
    };
  }

  if (policies.folderPrefix) {
    const prefix = policies.folderPrefix;
    if (folderPath !== prefix && !String(folderPath || '').startsWith(`${prefix}/`)) {
      return {
        ok: false,
        status: 403,
        code: 'POLICY_FOLDER_DENIED',
        message: `API Token policy restricts uploads to folder prefix "${policies.folderPrefix}/".`,
      };
    }
  }

  if (policies.allowedSourceHosts?.length) {
    const origin = String(request?.headers?.get('Origin') || request?.headers?.get('Referer') || '').trim();
    if (origin) {
      try {
        const host = new URL(origin).host.toLowerCase();
        if (!policies.allowedSourceHosts.includes(host)) {
          return {
            ok: false,
            status: 403,
            code: 'POLICY_SOURCE_DENIED',
            message: `API Token policy only allows source hosts: ${policies.allowedSourceHosts.join(', ')}.`,
          };
        }
      } catch {
        return { ok: false, status: 403, code: 'POLICY_SOURCE_DENIED', message: 'Invalid Origin/Referer header.' };
      }
    }
    // No Origin/Referer (server-to-server calls) -> allowed; browser clients
    // always send one of them on cross-origin requests.
  }

  return { ok: true };
}
