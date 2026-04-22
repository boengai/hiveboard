import type { Database } from 'bun:sqlite'
import { generateId } from './index'

export type WorkspaceSnapshotRow = {
  id: string
  taskId: string
  agentRunId: string | null
  statSummary: string
  statHash: string
  fileStatus: string
  hasPatch: boolean
  capturedAt: string
}

type DbListRow = {
  id: string
  task_id: string
  agent_run_id: string | null
  stat_summary: string
  stat_hash: string
  file_status: string
  patch_size: number | null
  captured_at: string
}

function mapListRow(r: DbListRow): WorkspaceSnapshotRow {
  return {
    agentRunId: r.agent_run_id,
    capturedAt: r.captured_at,
    fileStatus: r.file_status,
    hasPatch: r.patch_size !== null && r.patch_size > 0,
    id: r.id,
    statHash: r.stat_hash,
    statSummary: r.stat_summary,
    taskId: r.task_id,
  }
}

export function insertSnapshot(
  db: Database,
  input: {
    taskId: string
    agentRunId: string | null
    statSummary: string
    statHash: string
    fileStatus: string
    patch: Buffer | Uint8Array | null
  },
): string {
  const id = generateId()
  db.run(
    `INSERT INTO workspace_snapshots
       (id, task_id, agent_run_id, stat_summary, stat_hash, file_status, patch)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.taskId,
      input.agentRunId,
      input.statSummary,
      input.statHash,
      input.fileStatus,
      input.patch,
    ],
  )
  return id
}

export function listSnapshotsForTask(
  db: Database,
  taskId: string,
): WorkspaceSnapshotRow[] {
  const rows = db
    .query(
      `SELECT id, task_id, agent_run_id, stat_summary, stat_hash, file_status,
              length(patch) AS patch_size, captured_at
       FROM workspace_snapshots WHERE task_id = ? ORDER BY captured_at ASC`,
    )
    .all(taskId) as DbListRow[]
  return rows.map(mapListRow)
}

export function getSnapshotById(
  db: Database,
  id: string,
): WorkspaceSnapshotRow | null {
  const row = db
    .query(
      `SELECT id, task_id, agent_run_id, stat_summary, stat_hash, file_status,
              length(patch) AS patch_size, captured_at
       FROM workspace_snapshots WHERE id = ?`,
    )
    .get(id) as DbListRow | null
  return row ? mapListRow(row) : null
}

export function getSnapshotPatch(db: Database, id: string): Buffer | null {
  const row = db
    .query(`SELECT patch FROM workspace_snapshots WHERE id = ?`)
    .get(id) as { patch: Uint8Array | null } | null
  if (!row || row.patch === null) return null
  return Buffer.from(row.patch)
}

export function sumPatchBytesForTask(db: Database, taskId: string): number {
  const row = db
    .query(
      `SELECT COALESCE(SUM(length(patch)), 0) AS total
       FROM workspace_snapshots WHERE task_id = ? AND patch IS NOT NULL`,
    )
    .get(taskId) as { total: number } | null
  return Number(row?.total ?? 0)
}

export function getLastStatHashForTask(
  db: Database,
  taskId: string,
): string | null {
  const row = db
    .query(
      `SELECT stat_hash FROM workspace_snapshots
       WHERE task_id = ? ORDER BY captured_at DESC LIMIT 1`,
    )
    .get(taskId) as { stat_hash: string } | null
  return row?.stat_hash ?? null
}
