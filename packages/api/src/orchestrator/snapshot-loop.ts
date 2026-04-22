/**
 * Snapshot loop: captures a compressed `git diff HEAD` snapshot every
 * `config.progress.snapshot_interval_ms` while an agent is RUNNING.
 *
 * Workspace mutation note:
 * Runs `git add -N .` before each diff to surface untracked files in
 * `git diff HEAD --name-status`. This is idempotent (zero-blob index
 * entries honor .gitignore) but perturbs the index. Do NOT start this
 * loop in a workspace where the agent relies on an unmodified index
 * from a pre-snapshot baseline (e.g., a scripted "commit only if cached
 * diff is empty" flow).
 *
 * Disk-budget semantics:
 * `config.progress.snapshot_disk_budget_mb` acts as a hybrid soft-cap:
 *   1. If the summed compressed patch bytes already stored for this task
 *      exceed the budget, new snapshots store `patch=null` (stats only).
 *   2. If a single incoming patch's RAW size exceeds the budget, it is
 *      stored as `patch=null` (can't compress our way out of a rogue file).
 *   3. If `usedBefore_compressed + patchRawBytes > budget`, same —
 *      patch=null. This biases conservatively toward dropping rather than
 *      storing; the mix of raw/compressed on each side is intentional.
 */
import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { consola } from 'consola'
import type { Config } from '../config/schema'
import {
  getLastStatHashForTask,
  insertSnapshot,
  sumPatchBytesForTask,
  type WorkspaceSnapshotRow,
} from '../db/workspace-snapshots'
import { publishWorkspaceSnapshot } from '../pubsub'

const GIT_TIMEOUT_MS = 10_000

export type CaptureArgs = {
  db: Database
  config: Config
  taskId: string
  agentRunId: string | null
  workspacePath: string
  lastStatHash: string | null
}

export type FileStatusEntry = {
  path: string
  status: string
  additions: number
  deletions: number
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(['git', '-C', cwd, ...args], {
    stderr: 'pipe',
    stdout: 'pipe',
  })

  let timedOut = false
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    setTimeout(() => {
      timedOut = true
      try {
        proc.kill('SIGKILL')
      } catch {
        /* best effort */
      }
      resolve('timeout')
    }, GIT_TIMEOUT_MS)
  })

  // Read stdout concurrently but don't block on it — race against timeout.
  const stdoutPromise = new Response(proc.stdout).text().catch(() => '')

  const settled = await Promise.race([
    proc.exited.then(() => 'exited' as const),
    timeoutPromise,
  ])

  if (settled === 'timeout') {
    // The process has been SIGKILLed. Some grandchild may still hold stdout;
    // we don't wait for the reader — just throw. The dangling reader promise
    // resolves or rejects into the void harmlessly.
    throw new Error(`git ${args.join(' ')} timed out after ${GIT_TIMEOUT_MS}ms`)
  }

  // Process exited cleanly; stdoutPromise is guaranteed to resolve promptly now.
  const out = await stdoutPromise
  const exit = proc.exitCode ?? 0
  if (exit !== 0 && !timedOut) {
    const err = await new Response(proc.stderr).text().catch(() => '')
    throw new Error(`git ${args.join(' ')} exit ${exit}: ${err.slice(0, 200)}`)
  }
  return out
}

function parseNumstat(
  numstat: string,
): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>()
  for (const line of numstat.split('\n')) {
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const adds = parts[0] === '-' ? 0 : Number(parts[0] ?? 0)
    const dels = parts[1] === '-' ? 0 : Number(parts[1] ?? 0)
    const path = parts[2] ?? ''
    if (!path) continue
    map.set(path, { additions: adds, deletions: dels })
  }
  return map
}

function parseNameStatus(
  nameStatus: string,
): Array<{ path: string; status: string }> {
  const out: Array<{ path: string; status: string }> = []
  const parts = nameStatus.split('\0').filter((p) => p.length > 0)
  let i = 0
  while (i < parts.length) {
    const status = parts[i] ?? ''
    if (!status) {
      i++
      continue
    }
    if (status.startsWith('R') || status.startsWith('C')) {
      const to = parts[i + 2] ?? ''
      out.push({ path: to, status })
      i += 3
    } else {
      const path = parts[i + 1] ?? ''
      out.push({ path, status })
      i += 2
    }
  }
  return out
}

export async function captureWorkspaceSnapshot(
  args: CaptureArgs,
): Promise<WorkspaceSnapshotRow | null> {
  const { db, config, taskId, agentRunId, workspacePath, lastStatHash } = args

  let statSummary: string
  let nameStatusRaw: string
  let numstatRaw: string
  let patchRaw: string
  try {
    // Mark untracked files as intent-to-add so they appear in `git diff HEAD`.
    // This records empty blob hashes in the index but does NOT stage contents,
    // so it's non-destructive and idempotent.
    await runGit(['add', '-N', '.'], workspacePath)
    ;[statSummary, nameStatusRaw, numstatRaw, patchRaw] = await Promise.all([
      runGit(['diff', 'HEAD', '--stat'], workspacePath),
      runGit(['diff', 'HEAD', '--name-status', '-z'], workspacePath),
      runGit(['diff', 'HEAD', '--numstat'], workspacePath),
      runGit(['diff', 'HEAD'], workspacePath),
    ])
  } catch (err) {
    consola.warn(
      `captureWorkspaceSnapshot ${taskId}: ${(err as Error).message}`,
    )
    return null
  }

  const entries = parseNameStatus(nameStatusRaw)
  const numstat = parseNumstat(numstatRaw)
  const fileStatus: FileStatusEntry[] = entries.map((e) => {
    const n = numstat.get(e.path) ?? { additions: 0, deletions: 0 }
    return { ...n, path: e.path, status: e.status }
  })
  const fileStatusJson = JSON.stringify(fileStatus)

  const statHash = createHash('sha256')
    .update(fileStatusJson)
    .update('\n')
    .update(statSummary)
    .digest('hex')

  if (lastStatHash === statHash) return null
  if (fileStatus.length === 0 && patchRaw.length === 0) return null

  const budgetBytes = config.progress.snapshot_disk_budget_mb * 1024 * 1024
  const usedBefore = sumPatchBytesForTask(db, taskId)
  const patchRawBytes = Buffer.byteLength(patchRaw, 'utf8')

  let patchBlob: Buffer | null
  if (
    patchRawBytes === 0 ||
    usedBefore >= budgetBytes ||
    patchRawBytes > budgetBytes ||
    usedBefore + patchRawBytes > budgetBytes
  ) {
    // Either nothing to store, or this patch alone would blow (or has blown)
    // the per-task raw-diff budget. Skip the blob but still record the
    // stat summary + file-status entry so the timeline is continuous.
    patchBlob = null
  } else {
    try {
      const compressed = Bun.gzipSync(Buffer.from(patchRaw, 'utf8'))
      patchBlob = Buffer.from(compressed)
    } catch (err) {
      consola.warn(
        `captureWorkspaceSnapshot gzip failed ${taskId}: ${(err as Error).message}`,
      )
      patchBlob = null
    }
  }

  const id = insertSnapshot(db, {
    agentRunId,
    fileStatus: fileStatusJson,
    patch: patchBlob,
    statHash,
    statSummary,
    taskId,
  })

  const row: WorkspaceSnapshotRow = {
    agentRunId,
    capturedAt: new Date().toISOString(),
    fileStatus: fileStatusJson,
    hasPatch: patchBlob !== null,
    id,
    statHash,
    statSummary,
    taskId,
  }

  // Publish the GraphQL-shaped payload (fileStatus is a list, not a JSON
  // string). The DB row keeps fileStatus as JSON for storage; subscribers
  // need the parsed shape because the subscription `resolve` is a
  // pass-through and GraphQL expects [SnapshotFileEntry!]!.
  publishWorkspaceSnapshot(taskId, {
    agentRunId,
    capturedAt: row.capturedAt,
    fileStatus,
    hasPatch: row.hasPatch,
    id,
    statSummary,
    taskId,
  })
  return row
}

export type SnapshotLoopHandle = {
  stop: () => Promise<void>
}

export function startSnapshotLoop(opts: {
  db: Database
  config: Config
  taskId: string
  agentRunId: string | null
  workspacePath: string
}): SnapshotLoopHandle {
  const { db, config, taskId, agentRunId, workspacePath } = opts
  let lastStatHash = getLastStatHashForTask(db, taskId)
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let currentTick: Promise<void> | null = null

  const runCapture = async (): Promise<void> => {
    try {
      const row = await captureWorkspaceSnapshot({
        agentRunId,
        config,
        db,
        lastStatHash,
        taskId,
        workspacePath,
      })
      if (row) lastStatHash = row.statHash
    } catch (err) {
      consola.warn(`snapshot-loop ${taskId}: ${(err as Error).message}`)
    }
  }

  const tick = async (): Promise<void> => {
    if (stopped) return
    currentTick = runCapture()
    try {
      await currentTick
    } finally {
      currentTick = null
      if (!stopped) {
        timer = setTimeout(tick, config.progress.snapshot_interval_ms)
      }
    }
  }

  timer = setTimeout(tick, config.progress.snapshot_interval_ms)

  return {
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      // Wait for any in-flight tick to settle before capturing the final.
      if (currentTick) {
        try {
          await currentTick
        } catch {
          /* already logged */
        }
      }
      // Final snapshot — terminal state recorded.
      await runCapture()
    },
  }
}
