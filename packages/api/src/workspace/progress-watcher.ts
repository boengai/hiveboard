import type { FSWatcher } from 'node:fs'
import { mkdirSync, watch } from 'node:fs'
import { open } from 'node:fs/promises'
import { consola } from 'consola'
import type { Config } from '../config/schema'
import { agentStateDir, progressPath } from './agent-state'

const DEBOUNCE_MS = 100

export type ProgressStatus = 'in_progress' | 'done' | 'failed'

export type ProgressEntry = {
  ts: string
  step: number
  total: number
  label: string
  status: ProgressStatus
  detail?: string
}

type Disposer = () => void

const ALLOWED_STATUSES: Set<ProgressStatus> = new Set([
  'in_progress',
  'done',
  'failed',
])

/**
 * Parse NDJSON progress lines from an arbitrary chunk of text.
 * Returns validated entries and any trailing partial line to buffer.
 */
export function parseProgressLines(chunk: string): {
  entries: ProgressEntry[]
  remainder: string
} {
  const entries: ProgressEntry[] = []
  const lines = chunk.split('\n')
  const remainder = lines.pop() ?? ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const raw = JSON.parse(trimmed)
      if (
        typeof raw !== 'object' ||
        raw === null ||
        typeof raw.ts !== 'string' ||
        typeof raw.step !== 'number' ||
        typeof raw.total !== 'number' ||
        typeof raw.label !== 'string' ||
        typeof raw.status !== 'string' ||
        !ALLOWED_STATUSES.has(raw.status as ProgressStatus)
      ) {
        continue
      }
      const entry: ProgressEntry = {
        label: String(raw.label),
        status: raw.status as ProgressStatus,
        step: Number(raw.step),
        total: Number(raw.total),
        ts: String(raw.ts),
      }
      if (typeof raw.detail === 'string') entry.detail = raw.detail
      entries.push(entry)
    } catch {
      // malformed line — skip silently
    }
  }

  return { entries, remainder }
}

/**
 * Watch the per-task progress.ndjson file and invoke `onEntry` for each
 * appended NDJSON line, once and only once. In-memory offset; nothing
 * persists across API restarts (spec-mandated).
 *
 * - Debounced at 100 ms.
 * - Partial-line-safe: a trailing partial line buffers until the next fire.
 * - Hydrates with existing file contents so initial subscribers see prior entries.
 */
export function watchProgress(
  config: Config,
  taskId: string,
  onEntry: (entry: ProgressEntry) => void,
): Disposer {
  let dir: string
  try {
    dir = agentStateDir(config, taskId)
  } catch (err) {
    consola.warn(`watchProgress ${taskId}: ${(err as Error).message}`)
    return () => {}
  }
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* may already exist */
  }

  const filePath = progressPath(config, taskId)
  let offset = 0
  let remainder = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  let watcher: FSWatcher | null = null
  let disposed = false
  let pumping = false
  let pending = false

  const pump = async () => {
    if (disposed) return
    if (pumping) {
      pending = true
      return
    }
    pumping = true
    try {
      do {
        pending = false
        if (disposed) return
        const handle = await open(filePath, 'r').catch(
          (err: NodeJS.ErrnoException) => {
            if (err?.code !== 'ENOENT') {
              consola.warn(`watchProgress ${taskId}: ${(err as Error).message}`)
            }
            return null
          },
        )
        if (!handle) return
        try {
          const stat = await handle.stat()
          if (disposed) return
          if (stat.size < offset) {
            // File was truncated/replaced — restart from scratch.
            offset = 0
            remainder = ''
          }
          const toRead = stat.size - offset
          if (toRead <= 0) continue
          const buf = Buffer.alloc(toRead)
          const { bytesRead } = await handle.read(buf, 0, toRead, offset)
          offset += bytesRead
          const chunk = remainder + buf.subarray(0, bytesRead).toString('utf8')
          const parsed = parseProgressLines(chunk)
          remainder = parsed.remainder
          for (const entry of parsed.entries) {
            if (disposed) return
            try {
              onEntry(entry)
            } catch (err) {
              consola.warn(
                `watchProgress ${taskId} onEntry: ${(err as Error).message}`,
              )
            }
          }
        } finally {
          await handle.close()
        }
      } while (pending && !disposed)
    } finally {
      pumping = false
    }
  }

  try {
    watcher = watch(dir, { persistent: false }, (_event, filename) => {
      if (filename !== 'progress.ndjson') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void pump()
      }, DEBOUNCE_MS)
    })
    watcher.on('error', (err) => {
      consola.warn(
        `watchProgress ${taskId} watcher error: ${(err as Error).message}`,
      )
    })
  } catch (err) {
    consola.warn(`watchProgress ${taskId}: ${(err as Error).message}`)
  }

  // Hydrate with any pre-existing content.
  void pump()

  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
    watcher?.close()
  }
}
