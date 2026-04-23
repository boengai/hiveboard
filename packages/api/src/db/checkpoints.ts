import type { Database } from 'bun:sqlite'
import type { CheckpointKind } from '../agent/summarize'

export type CheckpointRow = {
  id: string
  agentRunId: string
  turn: number
  kind: CheckpointKind
  summary: string
  rawBytes: number
  occurredAt: string
}

export type InsertCheckpointInput = {
  id: string
  agentRunId: string
  turn: number
  kind: CheckpointKind
  summary: string
  rawBytes: number
}

export function insertCheckpoint(
  db: Database,
  input: InsertCheckpointInput,
): void {
  db.run(
    `INSERT INTO agent_run_checkpoints
       (id, agent_run_id, turn, kind, summary, raw_bytes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.agentRunId,
      input.turn,
      input.kind,
      input.summary,
      input.rawBytes,
    ],
  )
}

export function listCheckpointsForRun(
  db: Database,
  agentRunId: string,
): CheckpointRow[] {
  const rows = db
    .query(
      `SELECT id, agent_run_id, turn, kind, summary, raw_bytes, occurred_at
       FROM agent_run_checkpoints
       WHERE agent_run_id = ?
       ORDER BY turn ASC`,
    )
    .all(agentRunId) as Array<{
    id: string
    agent_run_id: string
    turn: number
    kind: CheckpointKind
    summary: string
    raw_bytes: number
    occurred_at: string
  }>
  return rows.map((r) => ({
    agentRunId: r.agent_run_id,
    id: r.id,
    kind: r.kind,
    occurredAt: r.occurred_at,
    rawBytes: r.raw_bytes,
    summary: r.summary,
    turn: r.turn,
  }))
}

export function countTurnsForRun(db: Database, agentRunId: string): number {
  const row = db
    .query(
      `SELECT COALESCE(MAX(turn), 0) AS max_turn
       FROM agent_run_checkpoints
       WHERE agent_run_id = ?`,
    )
    .get(agentRunId) as { max_turn: number } | null
  return row?.max_turn ?? 0
}
