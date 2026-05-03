import type { Database } from 'bun:sqlite'
import type { CheckpointRow } from '../db/checkpoints'
import { countTurnsForRun, listCheckpointsForRun } from '../db/checkpoints'
import type { PreviousAttemptReplay } from './runner'

const MAX_REPLAY_ENTRIES = 50
const LAST_N_TURNS = 20
const SAMPLE_BUCKET = 10

function isWriteOrEdit(row: CheckpointRow): boolean {
  if (row.kind !== 'tool_use') return false
  return (
    row.summary.startsWith('[tool Write]') ||
    row.summary.startsWith('[tool Edit]')
  )
}

export function selectCheckpointsForReplay(
  rows: CheckpointRow[],
): CheckpointRow[] {
  if (rows.length === 0) return []

  const byTurn = [...rows].sort((a, b) => a.turn - b.turn)
  const lastTurn = byTurn[byTurn.length - 1]!.turn
  const cutoff = lastTurn - LAST_N_TURNS

  const selected = new Map<string, CheckpointRow>() // id → row for dedupe

  // Always include last N turns.
  for (const r of byTurn) {
    if (r.turn > cutoff) selected.set(r.id, r)
  }

  // Always include every error.
  for (const r of byTurn) {
    if (r.kind === 'error') selected.set(r.id, r)
  }

  // Always include Write / Edit tool_use.
  for (const r of byTurn) {
    if (isWriteOrEdit(r)) selected.set(r.id, r)
  }

  // Sample one tool_use per 10-turn bucket from the earlier portion.
  const bucketSampled = new Set<number>()
  for (const r of byTurn) {
    if (r.turn > cutoff) continue
    if (r.kind !== 'tool_use') continue
    const bucket = Math.floor((r.turn - 1) / SAMPLE_BUCKET)
    if (bucketSampled.has(bucket)) continue
    bucketSampled.add(bucket)
    selected.set(r.id, r)
  }

  // Order and cap.
  const ordered = [...selected.values()].sort((a, b) => a.turn - b.turn)
  if (ordered.length <= MAX_REPLAY_ENTRIES) return ordered

  // Trim to cap in priority order:
  // 1. Drop earliest non-critical (sampled tool_use / Write/Edit outside last-N)
  // 2. Drop earliest errors (if still over cap — rare but possible with many errors)
  // Last-N-turns entries are never dropped.
  const toDrop = new Set<string>()

  const isLastN = (r: CheckpointRow) => r.turn > cutoff
  const nonCritical = ordered.filter((r) => !isLastN(r) && r.kind !== 'error')
  let overflow = ordered.length - MAX_REPLAY_ENTRIES

  for (const r of nonCritical) {
    if (overflow <= 0) break
    toDrop.add(r.id)
    overflow--
  }

  if (overflow > 0) {
    // Still over cap — trim oldest errors (outside last-N window)
    const earlyErrors = ordered.filter((r) => !isLastN(r) && r.kind === 'error')
    for (const r of earlyErrors) {
      if (overflow <= 0) break
      toDrop.add(r.id)
      overflow--
    }
  }

  return ordered.filter((r) => !toDrop.has(r.id))
}

// ---------------------------------------------------------------------------
// Checkpoint replay builder (exported for test + orchestrator dispatch)
// ---------------------------------------------------------------------------

/**
 * Given a task id, find the most recent FAILED agent_run that occurred AFTER
 * the most recent SUCCESS run (if any), then build a PreviousAttemptReplay
 * bundle from its checkpoints.
 *
 * Rationale: only replay the immediate prior attempt in the current retry
 * cycle. If the task previously succeeded then later failed, we want the
 * recently-failed run, not some ancient failed run from before the success.
 */
export function buildPreviousAttemptReplay(
  db: Database,
  taskId: string,
): PreviousAttemptReplay | null {
  const latestSuccess = db
    .query(
      `SELECT id, started_at FROM agent_runs
       WHERE task_id = ? AND status = 'success'
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .get(taskId) as { id: string; started_at: string } | null

  const failedRow = (
    latestSuccess
      ? db
          .query(
            `SELECT id, error FROM agent_runs
           WHERE task_id = ? AND status IN ('failed', 'fail_verify')
             AND (started_at > ? OR (started_at = ? AND id > ?))
           ORDER BY started_at DESC
           LIMIT 1`,
          )
          .get(
            taskId,
            latestSuccess.started_at,
            latestSuccess.started_at,
            latestSuccess.id,
          )
      : db
          .query(
            `SELECT id, error FROM agent_runs
           WHERE task_id = ? AND status IN ('failed', 'fail_verify')
           ORDER BY started_at DESC
           LIMIT 1`,
          )
          .get(taskId)
  ) as { id: string; error: string | null } | null

  if (!failedRow) return null

  const all = listCheckpointsForRun(db, failedRow.id)
  if (all.length === 0) {
    return {
      checkpoints: [],
      failure_summary:
        failedRow.error ?? 'previous attempt failed (no checkpoints available)',
      turn_count: 0,
    }
  }
  const selected = selectCheckpointsForReplay(all)
  return {
    checkpoints: selected.map((cp) => ({
      kind: cp.kind,
      summary: cp.summary,
      turn: cp.turn,
    })),
    failure_summary: failedRow.error ?? 'previous attempt failed',
    turn_count: countTurnsForRun(db, failedRow.id),
  }
}
