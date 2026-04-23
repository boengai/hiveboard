import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PARTIALS_DIR = dirname(fileURLToPath(import.meta.url))

let cached: Record<string, string> | null = null

/**
 * Load every `*.mustache` file in this directory as a named Mustache partial.
 * Keys are the filename without the `.mustache` suffix. Memoized — the files
 * are shipped with the package and never change at runtime.
 */
export function loadPromptPartials(): Record<string, string> {
  if (cached) return cached
  const result: Record<string, string> = {}
  const entries = readdirSync(PARTIALS_DIR, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.mustache')) continue
    const name = entry.name.slice(0, -'.mustache'.length)
    result[name] = readFileSync(resolve(PARTIALS_DIR, entry.name), 'utf8')
  }
  cached = result
  return result
}

/** Test-only escape hatch to reset the memoized cache. */
export function __resetPromptPartialsCacheForTests(): void {
  cached = null
}
