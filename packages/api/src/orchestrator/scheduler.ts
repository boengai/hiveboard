/**
 * Task scheduler. Selects the next batch of queued tasks eligible to spawn,
 * honoring task dependencies (no blocker is in-flight or failed).
 */

import type { Database } from 'bun:sqlite'
import type { TaskRow } from './orchestrator'

/**
 * Pick the next N queued tasks that are eligible to spawn. Dep-aware by
 * default: excludes any task with at least one blocker whose `agent_status`
 * is not `success`. Tie-broken by (direct-blocker count DESC, updated_at ASC)
 * so tasks deeper in the dependency chain are prioritized.
 *
 * `legacyMode=true` falls back to the pre-Plan-E SELECT that ignores
 * dependencies entirely. Kept as an escape hatch behind
 * `config.scheduler.legacy_mode`.
 *
 * Exported for unit tests; production callers should use the `poll()` wrapper.
 */
export function selectSchedulableTasks(
  db: Database,
  opts: { limit: number; legacyMode: boolean },
): TaskRow[] {
  if (opts.legacyMode) {
    return db
      .query(
        `SELECT * FROM tasks
          WHERE agent_status = 'queued'
            AND action IS NOT NULL
            AND (queue_after IS NULL OR queue_after <= datetime('now'))
          ORDER BY updated_at ASC
          LIMIT ?`,
      )
      .all(opts.limit) as TaskRow[]
  }

  return db
    .query(
      `SELECT t.* FROM tasks t
        WHERE t.agent_status = 'queued'
          AND t.action IS NOT NULL
          AND (t.queue_after IS NULL OR t.queue_after <= datetime('now'))
          AND NOT EXISTS (
            SELECT 1 FROM task_dependencies d
              JOIN tasks b ON b.id = d.blocker_id
             WHERE d.task_id = t.id AND b.agent_status != 'success'
          )
        ORDER BY
          (SELECT COUNT(*) FROM task_dependencies d2 WHERE d2.task_id = t.id) DESC,
          t.updated_at ASC
        LIMIT ?`,
    )
    .all(opts.limit) as TaskRow[]
}
