import { readlink, stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'

/**
 * Resolve symlinks segment-by-segment to detect escapes.
 * Returns the canonical path if safe, throws on escape or error.
 */
export async function resolvePathSafe(filePath: string): Promise<string> {
  if (!isAbsolute(filePath)) {
    throw new Error(`Path must be absolute: ${filePath}`)
  }

  const segments = filePath.split('/').filter(Boolean)
  let current = '/'

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (!seg) continue
    current = resolve(current, seg)

    try {
      const info = await stat(current)
      if (!info.isDirectory() && i < segments.length - 1) {
        throw new Error(`Not a directory at segment: ${current}`)
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Path doesn't exist yet — append remaining segments and return
        const remaining = segments.slice(i + 1).join('/')
        return remaining ? resolve(current, remaining) : current
      }
      throw err
    }

    // Check if current segment is a symlink
    try {
      const target = await readlink(current)
      const resolved = isAbsolute(target) ? target : resolve(dirname(current), target)
      // Re-resolve with remaining segments
      const remaining = segments.slice(i + 1)
      if (remaining.length > 0) {
        return resolvePathSafe(resolve(resolved, ...remaining))
      }
      return resolved
    } catch {
      // Not a symlink — continue
    }
  }

  return current
}

/**
 * Validate that a workspace path is safe:
 * - Must be under root
 * - Must not equal root
 * - Must not escape via symlinks
 */
export async function validateWorkspacePath(workspacePath: string, root: string): Promise<void> {
  const canonicalRoot = await resolvePathSafe(root)
  const canonicalPath = await resolvePathSafe(workspacePath)

  if (canonicalPath === canonicalRoot) {
    throw new Error(`Workspace path cannot be the root: ${workspacePath}`)
  }

  if (!canonicalPath.startsWith(`${canonicalRoot}/`)) {
    throw new Error(
      `Workspace path escapes root: ${workspacePath} → ${canonicalPath} (root: ${canonicalRoot})`
    )
  }
}
