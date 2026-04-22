import type { Database } from 'bun:sqlite'

/**
 * Record that `taskId` depends on `blockerId`. Idempotent via the (task_id,
 * blocker_id) primary key.
 */
export function addDependencyEdge(
  db: Database,
  taskId: string,
  blockerId: string,
): void {
  db.run(
    `INSERT OR IGNORE INTO task_dependencies (task_id, blocker_id) VALUES (?, ?)`,
    [taskId, blockerId],
  )
}

export function removeDependencyEdge(
  db: Database,
  taskId: string,
  blockerId: string,
): void {
  db.run(`DELETE FROM task_dependencies WHERE task_id = ? AND blocker_id = ?`, [
    taskId,
    blockerId,
  ])
}

/** Tasks that block the given task (its blockers). */
export function listBlockers(db: Database, taskId: string): string[] {
  const rows = db
    .query(
      `SELECT blocker_id FROM task_dependencies WHERE task_id = ? ORDER BY created_at ASC`,
    )
    .all(taskId) as Array<{ blocker_id: string }>
  return rows.map((r) => r.blocker_id)
}

/** Tasks that depend on the given task (its dependents). */
export function listDependents(db: Database, taskId: string): string[] {
  const rows = db
    .query(
      `SELECT task_id FROM task_dependencies WHERE blocker_id = ? ORDER BY created_at ASC`,
    )
    .all(taskId) as Array<{ task_id: string }>
  return rows.map((r) => r.task_id)
}

/**
 * Number of blockers whose `agent_status` is not 'success'. A task is
 * schedulable (dep-wise) iff this returns 0.
 */
export function unresolvedBlockerCount(db: Database, taskId: string): number {
  const row = db
    .query(
      `SELECT COUNT(*) AS n FROM task_dependencies d
         JOIN tasks t ON t.id = d.blocker_id
        WHERE d.task_id = ? AND t.agent_status != 'success'`,
    )
    .get(taskId) as { n: number }
  return row.n
}

/** Check if the two tasks share a board. Used for cross-board rejection. */
export function sameBoard(
  db: Database,
  taskIdA: string,
  taskIdB: string,
): boolean {
  const row = db
    .query(
      `SELECT
         (SELECT board_id FROM tasks WHERE id = ?) AS a_board,
         (SELECT board_id FROM tasks WHERE id = ?) AS b_board`,
    )
    .get(taskIdA, taskIdB) as { a_board: string | null; b_board: string | null }
  return (
    row.a_board !== null && row.b_board !== null && row.a_board === row.b_board
  )
}
