import { apiError, apiSuccess } from '../../utils/api-v1.js';
import sharePassword from '../../../server/lib/utils/share-password.cjs';

const { isValidPasswordSetting, passwordMetadata } = sharePassword;

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) {
    return apiError('INVALID_ORIGIN', 'Open the dashboard on this site to change the password.', 403);
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return apiError('VALIDATION_ERROR', 'Expected a JSON request.', 400);
  }
  const body = await request.json().catch(() => null);
  const { id, password } = body || {};
  if (typeof id !== 'string' || !id || !isValidPasswordSetting(password)) {
    return apiError('VALIDATION_ERROR', 'A file id and a password of 1–128 characters (or null) are required.', 400);
  }

  const patch = await passwordMetadata(password);
  const record = await env.img_url.getWithMetadata(id);
  if (!record?.metadata?.fileName || record.metadata.TimeStamp == null) {
    return apiError('FILE_NOT_FOUND', 'Indexed file not found.', 404);
  }
  await env.img_url.put(id, record.value ?? '', { metadata: { ...record.metadata, ...patch } });
  return apiSuccess({ sharePasswordProtected: password !== null });
}
