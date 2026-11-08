import { isAuthRequired } from './auth.js';

export const R2_MULTIPART_MIN_BYTES = 100 * 1024 * 1024 + 1;
export const R2_MULTIPART_MAX_BYTES = 20 * 1024 ** 3;
export const R2_MULTIPART_PART_BYTES = 16 * 1024 * 1024;

export function getR2MultipartMaxBytes(env) {
  return env?.img_url && isAuthRequired(env) &&
    typeof env.R2_BUCKET?.createMultipartUpload === 'function' &&
    typeof env.R2_BUCKET?.resumeMultipartUpload === 'function'
    ? R2_MULTIPART_MAX_BYTES
    : 0;
}
