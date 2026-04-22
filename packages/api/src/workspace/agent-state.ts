import { appendFile, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { consola } from 'consola'
import type { Config } from '../config/schema'

const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/
const MAX_INJECTED_BYTES = 64 * 1024
const TRUNCATION_MARKER = '<!-- truncated: earlier notes omitted -->\n'
const MAX_QUESTION_BYTES = 32 * 1024
const QUESTION_TRUNCATION_SUFFIX = '...[truncated]'

function assertValidTaskId(taskId: string): void {
  if (!ULID_REGEX.test(taskId)) {
    throw new Error(`invalid task id (expected ULID): ${taskId}`)
  }
}

/**
 * Return the per-task agent state directory under `config.agent.state_root`.
 *
 * The task id must be a valid Crockford base32 ULID
 * (26 chars, `[0-9A-HJKMNP-TV-Z]`); anything else throws so path traversal
 * (e.g. `../evil`) cannot reach this helper.
 */
export function agentStateDir(config: Config, taskId: string): string {
  assertValidTaskId(taskId)
  return join(config.agent.state_root, taskId)
}

/** Path to `scratchpad.md` inside the per-task agent state directory. */
export function scratchpadPath(config: Config, taskId: string): string {
  return join(agentStateDir(config, taskId), 'scratchpad.md')
}

/**
 * Read the scratchpad for a task, capped at 64 KB (tail).
 *
 * - Returns `''` if the task id is invalid, the file is missing, or any read
 *   error occurs (errors other than ENOENT are logged via consola.warn).
 * - If the file exceeds 64 KB, returns the last 64 KB prefixed with a
 *   truncation marker so the agent knows earlier notes were omitted.
 */
export async function readScratchpad(
  config: Config,
  taskId: string,
): Promise<string> {
  try {
    assertValidTaskId(taskId)
  } catch {
    return ''
  }
  try {
    const buf = await readFile(scratchpadPath(config, taskId))
    if (buf.byteLength <= MAX_INJECTED_BYTES) {
      return buf.toString('utf8')
    }
    const tail = buf
      .subarray(buf.byteLength - MAX_INJECTED_BYTES)
      .toString('utf8')
    return TRUNCATION_MARKER + tail
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return ''
    consola.warn(`readScratchpad ${taskId}: ${(err as Error).message}`)
    return ''
  }
}

/**
 * Remove the per-task agent state directory and all of its contents.
 *
 * - Silently returns on invalid task ids (logs a warning) so path traversal
 *   attempts can't escape `state_root`.
 * - Idempotent: a missing directory is not an error.
 */
export async function deleteAgentState(
  config: Config,
  taskId: string,
): Promise<void> {
  try {
    assertValidTaskId(taskId)
  } catch (err) {
    consola.warn(`deleteAgentState: ${(err as Error).message}`)
    return
  }
  try {
    await rm(agentStateDir(config, taskId), { force: true, recursive: true })
  } catch (err) {
    consola.warn(`deleteAgentState ${taskId}: ${(err as Error).message}`)
  }
}

/**
 * Remove any directory under `config.agent.state_root` whose name is not in
 * the provided live ULID set (or whose name isn't a valid ULID at all).
 *
 * Returns the number of entries removed. If `state_root` does not exist,
 * returns 0 cleanly.
 */
export async function sweepOrphanAgentStateDirs(
  config: Config,
  liveTaskIds: Set<string>,
): Promise<number> {
  const root = config.agent.state_root
  let removed = 0
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return 0
    throw err
  }
  for (const name of entries) {
    const isLiveUlid = ULID_REGEX.test(name) && liveTaskIds.has(name)
    if (isLiveUlid) continue
    try {
      await rm(join(root, name), { force: true, recursive: true })
      removed++
    } catch (err) {
      consola.warn(`sweep: failed to remove ${name}: ${(err as Error).message}`)
    }
  }
  if (removed > 0)
    consola.info(`sweep: removed ${removed} orphan agent-state dir(s)`)
  return removed
}

/** Path to `inbox.md` inside the per-task agent state directory. */
export function inboxPath(config: Config, taskId: string): string {
  return join(agentStateDir(config, taskId), 'inbox.md')
}

/** Path to `question.md` inside the per-task agent state directory. */
export function questionPath(config: Config, taskId: string): string {
  return join(agentStateDir(config, taskId), 'question.md')
}

/** Path to `progress.ndjson` inside the per-task agent state directory. */
export function progressPath(config: Config, taskId: string): string {
  return join(agentStateDir(config, taskId), 'progress.ndjson')
}

/**
 * Read the question file for a task, capped at 32 KB with a truncation suffix.
 * Returns '' on invalid id, missing file, or read error (non-ENOENT errors logged).
 */
export async function readQuestion(
  config: Config,
  taskId: string,
): Promise<string> {
  try {
    assertValidTaskId(taskId)
  } catch {
    return ''
  }
  try {
    const buf = await readFile(questionPath(config, taskId))
    const str = buf.toString('utf8').trim()
    if (str.length === 0) return ''
    if (buf.byteLength > MAX_QUESTION_BYTES) {
      const head = str.slice(
        0,
        MAX_QUESTION_BYTES - QUESTION_TRUNCATION_SUFFIX.length,
      )
      return head + QUESTION_TRUNCATION_SUFFIX
    }
    return str
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return ''
    consola.warn(`readQuestion ${taskId}: ${(err as Error).message}`)
    return ''
  }
}

/**
 * Append an entry to the task's scratchpad.md (created if missing).
 * Used by the orchestrator to record verification summaries.
 * Silently no-ops on invalid id; errors logged but not thrown.
 */
export async function appendScratchpadEntry(
  config: Config,
  taskId: string,
  entry: string,
): Promise<void> {
  try {
    assertValidTaskId(taskId)
  } catch {
    return
  }
  try {
    const dir = agentStateDir(config, taskId)
    await mkdir(dir, { recursive: true })
    const trailing = entry.endsWith('\n') ? '' : '\n'
    await appendFile(scratchpadPath(config, taskId), `\n${entry}${trailing}`)
  } catch (err) {
    consola.warn(`appendScratchpadEntry ${taskId}: ${(err as Error).message}`)
  }
}

/**
 * Append a line to the task's inbox file. Creates the directory if needed.
 * Silently returns on invalid id. Errors logged, not thrown.
 */
export async function appendToInbox(
  config: Config,
  taskId: string,
  line: string,
): Promise<void> {
  try {
    assertValidTaskId(taskId)
  } catch {
    return
  }
  try {
    const dir = agentStateDir(config, taskId)
    await mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString()
    await appendFile(inboxPath(config, taskId), `\n---\n${stamp}\n${line}\n`)
  } catch (err) {
    consola.warn(`appendToInbox ${taskId}: ${(err as Error).message}`)
  }
}
