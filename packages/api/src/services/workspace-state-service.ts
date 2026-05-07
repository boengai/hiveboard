/**
 * Workspace-state read service. Exposes typed reads of agent-state files
 * (scratchpad, progress NDJSON) so resolvers do not depend on the on-disk
 * layout. Auth lives at the resolver layer.
 */

import { readFile } from 'node:fs/promises'
import { getConfig } from '../config'
import { progressPath, readScratchpad } from '../workspace/agent-state'
import { parseProgressLines } from '../workspace/progress-watcher'

export type ProgressEntry = {
  detail: string | null
  label: string
  status: string
  step: number | null
  total: number | null
  ts: string
}

export async function getScratchpad(taskId: string): Promise<string> {
  const config = getConfig()
  if (!config) return ''
  return readScratchpad(config, taskId)
}

export async function readProgressEntries(
  taskId: string,
): Promise<ProgressEntry[]> {
  const config = getConfig()
  if (!config) return []
  let buf: Buffer
  try {
    buf = await readFile(progressPath(config, taskId))
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return []
    throw err
  }
  const { entries } = parseProgressLines(`${buf.toString('utf8')}\n`)
  return entries.map((e) => ({
    detail: e.detail ?? null,
    label: e.label,
    status: e.status.toUpperCase(),
    step: e.step,
    total: e.total,
    ts: e.ts,
  }))
}
