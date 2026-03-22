import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { consola } from 'consola'
import { getUploadDir } from '../routes/uploadDir'

const ONE_HOUR_MS = 3_600_000
const DEFAULT_MAX_AGE_MS = 86_400_000 // 24 hours

/** Remove temp upload directories older than maxAgeMs. */
export async function cleanupTempUploads(
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): Promise<number> {
  const tmpDir = join(getUploadDir(), 'tmp')
  const cutoff = Date.now() - maxAgeMs
  let removed = 0

  let entries: string[]
  try {
    entries = await readdir(tmpDir)
  } catch {
    return 0 // tmp dir doesn't exist yet
  }

  for (const entry of entries) {
    const entryPath = join(tmpDir, entry)
    const info = await stat(entryPath).catch(() => null)
    if (!info?.isDirectory()) continue

    if (info.mtimeMs < cutoff) {
      consola.info(`Cleaning up expired temp upload: ${entryPath}`)
      await rm(entryPath, { force: true, recursive: true })
      removed++
    }
  }

  if (removed > 0) {
    consola.info(`Cleaned up ${removed} expired temp upload(s)`)
  }

  return removed
}

/** Start periodic cleanup (runs immediately, then every hour). */
export function startCleanupInterval(): void {
  cleanupTempUploads().catch((err) => consola.warn('Temp cleanup error:', err))
  setInterval(
    () =>
      cleanupTempUploads().catch((err) =>
        consola.warn('Temp cleanup error:', err),
      ),
    ONE_HOUR_MS,
  )
}
