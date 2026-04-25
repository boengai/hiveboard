import { consola } from 'consola'

import { db } from '../../db'
import { transition as taskLifecycleTransition } from '../../lifecycle'
import type { OutcomeDeps } from './shared'

/**
 * Verify-gate dispatch. Called from `applySuccess` when `verifyAndGate`
 * returned `'fail'`. Either:
 *   - Auto-REVISE: queue a revise run if `verify_attempt_count` is still
 *     under `config.verify.max_auto_revises`.
 *   - Exhausted: transition to FAILED with `verification_exhausted`.
 *
 * Splitting this from `applyFailure` is intentional: a verify failure
 * is a parent-task code-quality signal; a natural failure is an agent
 * exit-code signal. They diverge on `cascadeDependencyFailure`
 * (verify-fail does not cascade because the work is in flight).
 */
export function applyVerificationFailure(
  deps: OutcomeDeps,
  sourceAgentRunId: string,
): void {
  const { task, config } = deps

  const current = db
    .query('SELECT verify_attempt_count FROM tasks WHERE id = ?')
    .get(task.id) as { verify_attempt_count: number } | null
  const nextAttempt = (current?.verify_attempt_count ?? 0) + 1
  const cap = config.verify.max_auto_revises

  if (nextAttempt > cap) {
    const reason = `verification failed after ${nextAttempt - 1} attempt(s)`
    taskLifecycleTransition({
      event: {
        actor: 'SYSTEM',
        data: { attempts: nextAttempt - 1 },
        type: 'verification_exhausted',
      },
      extras: (txDb) => {
        txDb.run(
          `UPDATE tasks SET
             agent_error=?,
             action=NULL,
             verify_attempt_count=?,
             pending_auto_revise_source_run_id=NULL
           WHERE id=?`,
          [reason, nextAttempt - 1, task.id],
        )
        txDb.run(
          `UPDATE agent_runs SET status='failed', error=?, finished_at=datetime('now') WHERE id=?`,
          [reason, sourceAgentRunId],
        )
      },
      taskId: task.id,
      to: 'failed',
      db,
    })
    consola.warn(`Task ${task.id}: ${reason}; transitioning to FAILED`)
    return
  }

  taskLifecycleTransition({
    event: {
      actor: 'SYSTEM',
      data: {
        attempt: nextAttempt,
        source_agent_run_id: sourceAgentRunId,
      },
      type: 'auto_revise_dispatched',
    },
    extras: (txDb) => {
      txDb.run(
        `UPDATE tasks SET
           action='revise',
           agent_error=NULL,
           verify_attempt_count=?,
           pending_auto_revise_source_run_id=?,
           queue_after=datetime('now','+5 seconds')
         WHERE id=?`,
        [nextAttempt, sourceAgentRunId, task.id],
      )
      txDb.run(
        `UPDATE agent_runs SET status='fail_verify', finished_at=datetime('now') WHERE id=?`,
        [sourceAgentRunId],
      )
    },
    taskId: task.id,
    to: 'queued',
    db,
  })

  consola.info(
    `Task ${task.id}: verification failed (attempt ${nextAttempt}/${cap}); auto-REVISE dispatched`,
  )
}
