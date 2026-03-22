import { join, resolve } from 'node:path'

/** Project root: packages/api/src/routes/../../../.. → project root */
const PROJECT_ROOT = resolve(import.meta.dir, '../../../..')

/**
 * Resolve the upload directory root.
 * Default: {projectRoot}/tmp/uploads.
 * Docker users can set UPLOAD_DIR env var to a mounted volume path.
 */
export function getUploadDir(): string {
  return resolve(process.env.UPLOAD_DIR ?? join(PROJECT_ROOT, 'tmp/uploads'))
}
