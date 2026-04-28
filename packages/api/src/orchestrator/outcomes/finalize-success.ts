import { consola } from 'consola'

import { db, generateId } from '../../db'
import { transition as taskLifecycleTransition } from '../../lifecycle'
import { mapTaskRow } from '../../lifecycle/task-row'
import { pubsub } from '../../pubsub'
import { slugify } from '../../workspace/manager'
import {
  extractPlanFromOutput,
  findColumnId,
  findColumnName,
  type TaskRow,
} from '../orchestrator'
import type { OutcomeDeps } from './shared'

/**
 * Final stage of the SUCCESS outcome — runs only after `verifyAndGate`
 * has passed (or been skipped). Owns the parts of "what success means
 * for the user": locate the PR, move to Review/Todo, persist the plan
 * body if any, and republish dependents whose chain-link badge just
 * decremented.
 *
 * Splitting this from `applySuccess` matters because `applySuccess` is
 * a thin orchestration (subtasks → verify → finalize) — finalize is
 * where the action-specific logic lives.
 */
export async function finalizeSuccess(deps: OutcomeDeps): Promise<void> {
  const { task, runId, result, github } = deps

  let prUrl: string | null = null
  if (task.action === 'implement' || task.action === 'revise') {
    prUrl = parsePrUrlFromOutput(result.output, task.target_repo)
  }

  if (
    !prUrl &&
    task.target_repo &&
    (task.action === 'implement' || task.action === 'revise')
  ) {
    const [owner, repo] = task.target_repo.split('/')
    if (owner && repo) {
      const branch = `task-${task.id.slice(-6)}/${slugify(task.title)}`
      prUrl = await github.findPrByHead(owner, repo, branch)
      if (prUrl) {
        consola.info(`Found PR URL via GitHub API fallback: ${prUrl}`)
      }
    }
  }

  // Contradiction guard: an `implement`/`revise` run that ended with the SDK
  // reporting success but produced no PR on the remote means the agent
  // either failed to push (e.g. 401 it described in prose without using the
  // structured signal), failed to call `gh pr create`, or pushed against the
  // wrong head. Don't let `pr_url IS NULL AND agent_status='success'` be
  // representable — coerce to BLOCKED so the user sees the failure.
  if (
    !prUrl &&
    task.target_repo &&
    (task.action === 'implement' || task.action === 'revise')
  ) {
    consola.error(
      `Task ${task.id} (${task.action}) ended success but no PR exists on ${task.target_repo} — coercing to BLOCKED`,
    )
    taskLifecycleTransition({
      blockReason: 'NO_PR_CREATED',
      event: {
        actor: 'SYSTEM',
        data: { action: task.action, target_repo: task.target_repo },
        type: 'agent_blocked',
      },
      extras: (txDb) => {
        txDb.run(
          `UPDATE tasks SET action = NULL, agent_output = ? WHERE id = ?`,
          [result.output, task.id],
        )
        txDb.run(
          `UPDATE agent_runs SET status = 'blocked', output = ?, finished_at = datetime('now') WHERE id = ?`,
          [result.output, runId],
        )
      },
      taskId: task.id,
      to: 'blocked',
    })
    return
  }

  let targetColumnName: string | null = null
  if (task.action === 'plan') {
    targetColumnName = 'Todo'
  } else if (task.action === 'implement' || task.action === 'revise') {
    targetColumnName = 'Review'
  }

  let targetColumnId: string | null = null
  if (targetColumnName) {
    targetColumnId = findColumnId(task.board_id, targetColumnName)
  }

  let planBody: string | null = null
  if (task.action === 'plan' && result.output) {
    planBody = extractPlanFromOutput(result.output, task.body)
  }

  taskLifecycleTransition({
    event: {
      actor: 'SYSTEM',
      data: { action: task.action, pr_url: prUrl },
      type: 'agent_succeeded',
    },
    extras: (txDb) => {
      const setParts = [`action = NULL`, `agent_output = ?`]
      const setValues: (string | number | null)[] = [result.output]

      if (planBody) {
        setParts.push('body = ?')
        setValues.push(planBody)
      }
      if (prUrl) {
        setParts.push('pr_url = ?')
        setValues.push(prUrl)
      }
      if (targetColumnId) {
        setParts.push('column_id = ?')
        setValues.push(targetColumnId)
      }

      setValues.push(task.id)
      txDb.run(
        `UPDATE tasks SET ${setParts.join(', ')} WHERE id = ?`,
        setValues,
      )

      txDb.run(
        `UPDATE agent_runs SET status = 'success', output = ?, finished_at = datetime('now') WHERE id = ?`,
        [result.output, runId],
      )

      if (targetColumnId && targetColumnName) {
        const fromColumnName = findColumnName(task.column_id)
        txDb.run(
          'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
          [
            generateId(),
            task.id,
            'SYSTEM',
            'moved',
            JSON.stringify({
              from_column: fromColumnName,
              to_column: targetColumnName,
            }),
          ],
        )
      }
    },
    taskId: task.id,
    to: 'success',
    db,
  })

  republishDependents(task.id)
}

function parsePrUrlFromOutput(
  output: string,
  targetRepo: string | null,
): string | null {
  const match = output.match(
    /https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/,
  )
  if (!match) return null
  const prRepo = match[1]
  if (targetRepo && prRepo !== targetRepo) {
    consola.warn(
      `PR URL ${match[0]} does not belong to target repo ${targetRepo} — ignoring`,
    )
    return null
  }
  return match[0] ?? null
}

function republishDependents(blockerTaskId: string): void {
  const dependentRows = db
    .query(
      `SELECT t.* FROM tasks t
         JOIN task_dependencies d ON d.task_id = t.id
        WHERE d.blocker_id = ?`,
    )
    .all(blockerTaskId) as TaskRow[]
  for (const depRow of dependentRows) {
    // Use raw pubsub.publish so this dependent fan-out is captured by tests
    // that mock pubsub.publish but not the publishTaskUpdated helper.
    pubsub.publish(
      'TASK_UPDATED',
      depRow.board_id,
      mapTaskRow(depRow) as unknown as Record<string, unknown>,
    )
  }
}
