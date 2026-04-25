import { db } from '../../db'
import { transition as taskLifecycleTransition } from '../../lifecycle'
import type { OutcomeDeps } from './shared'

/**
 * RUNNING → BLOCKED (TIMEOUT). The run was killed by the per-task wall
 * clock; we mark the run failed and record the lifetime budget on the
 * `time_box_expired` event so the UI can show how far past it ran.
 */
export function applyTimeout(deps: OutcomeDeps): void {
  const { task, runId } = deps
  taskLifecycleTransition({
    blockReason: 'TIMEOUT',
    event: {
      actor: 'SYSTEM',
      data: { limit_ms: task.time_box_ms },
      type: 'time_box_expired',
    },
    extras: (txDb) => {
      txDb.run(
        `UPDATE agent_runs SET status = 'failed', finished_at = datetime('now'), error = ? WHERE id = ?`,
        ['time-box expired', runId],
      )
    },
    taskId: task.id,
    to: 'blocked',
    db,
  })
}
