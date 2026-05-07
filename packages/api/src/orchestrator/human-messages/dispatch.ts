import { consola } from 'consola'
import type { Config } from '../../config/schema'
import { db } from '../../db'
import { transition as taskLifecycleTransition } from '../../lifecycle'
import { appendToInbox } from '../../workspace/agent-state'

/**
 * Minimal subset of Orchestrator's RunState that dispatchHumanMessage needs.
 * Decouples this module from the full RunState shape in orchestrator.ts.
 */
export interface AbortableRunState {
  abortController: AbortController
  abortReason?: 'TIMEOUT' | 'REDIRECT' | 'CANCEL'
}

export interface HumanMessageDeps {
  /** Live map of taskId → RunState owned by the Orchestrator. */
  running: Map<string, AbortableRunState>
  config: Config
}

/**
 * React to a human-authored message for a task. Called by the GraphQL
 * resolvers (sendHint/sendRedirect) AFTER the task_messages row is inserted,
 * so the mutation can decide whether the message triggers an immediate
 * orchestrator action (redirect = abort+requeue; hint = inbox append).
 * 'answer' messages are handled by the answerQuestion mutation directly and
 * are a no-op here.
 */
export async function dispatchHumanMessage(
  deps: HumanMessageDeps,
  taskId: string,
  kind: 'hint' | 'redirect' | 'answer',
  body: string,
  messageId?: string,
): Promise<void> {
  if (kind === 'answer') return

  const row = db
    .query('SELECT agent_status FROM tasks WHERE id = ?')
    .get(taskId) as { agent_status: string } | null
  if (!row) return
  const isRunning = row.agent_status === 'running'

  if (kind === 'redirect') {
    const runState = deps.running.get(taskId)
    if (runState) {
      consola.info(`Redirect received for task ${taskId} — aborting agent`)
      runState.abortReason = 'REDIRECT'
      runState.abortController.abort()
    }
    if (isRunning) {
      // Requeue with a short grace window so follow-up messages can batch.
      // Redirect is a human kick: reset verification state so the new run
      // starts fresh, not mid-retry.
      taskLifecycleTransition({
        extras: (txDb) => {
          txDb.run(
            `UPDATE tasks SET
               queue_after = datetime('now', '+5 seconds'),
               verify_attempt_count = 0,
               pending_auto_revise_source_run_id = NULL
             WHERE id = ?`,
            [taskId],
          )
        },
        from: 'running',
        taskId,
        to: 'queued',
      })
    }
    return
  }

  // kind === 'hint'
  if (!isRunning) return
  await appendToInbox(deps.config, taskId, `[hint] ${body}`)
  if (messageId) {
    // Mark only the specific row just inserted. Prevents a race where two
    // concurrent hints would each mark ALL undelivered hints delivered,
    // silently dropping the one that wasn't actually appended.
    db.run(
      `UPDATE task_messages SET delivered_at = datetime('now')
       WHERE id = ? AND delivered_at IS NULL`,
      [messageId],
    )
  }
}
