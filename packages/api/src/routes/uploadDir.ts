import { join, resolve } from 'node:path'

const PROJECT_ROOT = process.cwd()

/**
 * Resolve the upload directory root.
 * Default: {projectRoot}/tmp/uploads.
 * Docker users can set UPLOAD_DIR env var to a mounted volume path.
 */
export function getUploadDir(): string {
  return resolve(process.env.UPLOAD_DIR ?? join(PROJECT_ROOT, 'tmp/uploads'))
}
