import { consola } from 'consola'

import { db } from '../../db'
import { transition as taskLifecycleTransition } from '../../lifecycle'
import { cascadeDependencyFailure } from '../dependencies'
import type { OutcomeDeps } from './shared'

/**
 * RUNNING → FAILED. The agent exited non-zero with no question. After
 * the transition we cascade to direct dependents (each moves to
 * BLOCKED with `block_reason='DEPENDENCY_FAILED'` via the lifecycle
 * module) and schedule a retry with exponential backoff.
 */
export async function applyFailure(deps: OutcomeDeps): Promise<void> {
  const { task, runId, result, scheduleRetry } = deps

  consola.warn(`Task ${task.id} failed: ${result.error?.slice(0, 100)}`)

  taskLifecycleTransition({
    event: {
      actor: 'SYSTEM',
      data: { action: task.action, error: result.error },
      type: 'agent_failed',
    },
    extras: (txDb) => {
      txDb.run(`UPDATE tasks SET agent_error = ? WHERE id = ?`, [
        result.error ?? null,
        task.id,
      ])
      txDb.run(
        `UPDATE agent_runs SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?`,
        [result.error ?? null, runId],
      )
    },
    taskId: task.id,
    to: 'failed',
    db,
  })

  cascadeDependencyFailure(db, task.id)

  await scheduleRetry(task, result.error ?? 'Unknown error')
}
