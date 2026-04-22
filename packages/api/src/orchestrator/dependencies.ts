import type { Database } from 'bun:sqlite'

/**
 * Statuses that cascadeDependencyFailure skips: already terminal, already
 * blocked by a prior cascade (idempotency), or currently running (we do not
 * yank in-flight agents mid-execution).
 */
const CASCADE_SKIP_STATUSES = new Set([
  'success',
  'failed',
  'blocked',
  'running',
])

/**
 * Would adding the edge `(taskId depends on blockerId)` form a cycle?
 *
 * An edge `(task_id=X, blocker_id=Y)` means "X is blocked by Y" — i.e. Y must
 * complete before X can run. A cycle exists iff the prospective blocker
 * transitively depends on the task already. We walk blockerId's transitive
 * blocker set; if taskId is in it, closing the edge creates a cycle.
 *
 * Self-edges are treated as cycles.
 */
export function wouldCreateCycle(
  db: Database,
  taskId: string,
  blockerId: string,
): boolean {
  if (taskId === blockerId) return true

  const visited = new Set<string>([blockerId])
  const stack: string[] = [blockerId]

  while (stack.length > 0) {
    const current = stack.pop() as string
    if (current === taskId) return true
    const rows = db
      .query(`SELECT blocker_id FROM task_dependencies WHERE task_id = ?`)
      .all(current) as Array<{ blocker_id: string }>
    for (const r of rows) {
      if (!visited.has(r.blocker_id)) {
        visited.add(r.blocker_id)
        stack.push(r.blocker_id)
      }
    }
  }
  return false
}

/**
 * When a task transitions to FAILED, move its direct dependents that are not
 * already SUCCESS / FAILED to BLOCKED with `block_reason='DEPENDENCY_FAILED'`.
 * Returns the list of task ids that were moved.
 *
 * Only the direct dependents are cascaded — if a dependent was itself in the
 * middle of running, we do not kill it. The scheduler's dep-aware SELECT
 * already stops any queued downstream from being picked up.
 */
export function cascadeDependencyFailure(
  db: Database,
  failedTaskId: string,
): string[] {
  const dependents = db
    .query(`SELECT task_id FROM task_dependencies WHERE blocker_id = ?`)
    .all(failedTaskId) as Array<{ task_id: string }>

  const moved: string[] = []
  for (const { task_id } of dependents) {
    const row = db
      .query(`SELECT agent_status FROM tasks WHERE id = ?`)
      .get(task_id) as { agent_status: string } | null
    if (!row) continue
    // Skip dependents that are already terminal, already blocked by a prior
    // cascade (idempotency), or currently running (we don't yank an in-flight
    // agent into BLOCKED mid-execution — its own onComplete path will run).
    if (CASCADE_SKIP_STATUSES.has(row.agent_status)) continue
    db.run(
      `UPDATE tasks
          SET agent_status = 'blocked',
              block_reason = 'DEPENDENCY_FAILED',
              updated_at = datetime('now')
        WHERE id = ?`,
      [task_id],
    )
    moved.push(task_id)
  }
  return moved
}
