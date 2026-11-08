import { serveFile as serveFileInternal } from '../../../file/[id].js';
import { onRequest as deleteFileInternal } from '../../manage/delete/[id].js';
import { apiError, apiSuccess, decodePathParam } from '../../../utils/api-v1.js';

async function handleRead(context) {
  const id = decodePathParam(context.params?.id || '');
  if (!id) {
    return apiError('VALIDATION_ERROR', 'File id is required.', 400);
  }

  const response = await serveFileInternal({
    ...context,
    params: {
      ...(context.params || {}),
      id,
    },
  });

  if (response.status >= 400) {
    let message = 'Failed to read file.';
    try {
      const text = await response.clone().text();
      if (text) {
        message = text;
      }
    } catch {
      // keep fallback
    }

    if (response.status === 404) {
      return apiError('FILE_NOT_FOUND', 'File not found.', 404);
    }
    if (response.status === 401) {
      return apiError('FILE_PASSWORD_REQUIRED', message, 401);
    }
    if (response.status === 403) {
      return apiError('FILE_ACCESS_DENIED', message, 403);
    }
    if (response.status === 410) {
      return apiError('FILE_LINK_EXPIRED', message, 410);
    }
    return apiError('FILE_READ_FAILED', message, response.status || 500);
  }

  return response;
}

async function handleDelete(context) {
  const id = decodePathParam(context.params?.id || '');
  if (!id) {
    return apiError('VALIDATION_ERROR', 'File id is required.', 400);
  }

  const response = await deleteFileInternal({
    ...context,
    params: {
      ...(context.params || {}),
      id,
    },
  });

  let payload = null;
  try {
    payload = await response.clone().json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.success) {
    if (response.status === 404) {
      return apiError('FILE_NOT_FOUND', 'File not found.', 404);
    }

    return apiError(
      'FILE_DELETE_FAILED',
      payload?.error || 'Failed to delete file.',
      response.status || 500
    );
  }

  return apiSuccess({
    deleted: true,
    fileId: id,
    message: payload?.message || 'File deleted.',
  });
}

export async function onRequest(context) {
  const method = String(context.request.method || 'GET').toUpperCase();

  if (method === 'GET') {
    return handleRead(context);
  }

  if (method === 'DELETE') {
    return handleDelete(context);
  }

  return apiError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
}
