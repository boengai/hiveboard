/**
 * Agent-run lifecycle DB ops. Owns the agent_runs row insert (with playbook
 * version resolution) and the failed → queued retry transition.
 */

import type { Database } from 'bun:sqlite'
import { consola } from 'consola'
import { GraphQLError } from 'graphql'
import { transition as taskLifecycleTransition } from '../lifecycle'
import { getPlaybookByName } from '../playbooks'

export type InsertAgentRunInput = {
  db: Database
  runId: string
  taskId: string
  action: string
}

/**
 * Insert a row into `agent_runs` for a dispatch. Looks up the playbook
 * version if the action is `playbook:<name>` and records it as
 * `playbook_version_id` for audit. Missing playbooks degrade to NULL
 * (logged) — the dispatcher will separately reject the action at resolver
 * time, so this path is defensive.
 */
export function insertAgentRun(input: InsertAgentRunInput): void {
  let playbookVersionId: string | null = null
  if (input.action.startsWith('playbook:')) {
    const name = input.action.slice('playbook:'.length)
    const pb = getPlaybookByName(input.db, name)
    if (pb) {
      playbookVersionId = pb.currentVersion.id
    } else {
      consola.warn(
        `insertAgentRun: playbook "${name}" not found; recording NULL playbook_version_id`,
      )
    }
  }

  input.db.run(
    `INSERT INTO agent_runs (id, task_id, action, status, started_at, playbook_version_id) VALUES (?, ?, ?, 'running', datetime('now'), ?)`,
    [input.runId, input.taskId, input.action, playbookVersionId],
  )
}

/** Test-only re-export to avoid importing private class internals. */
export function insertAgentRunForTest(input: InsertAgentRunInput): void {
  insertAgentRun(input)
}

/**
 * Transitions a task from 'failed' → 'queued', incrementing retry_count.
 * Optionally appends an instruction to the existing agent_instruction.
 * Named `continueFailedTaskDb` to avoid collision with the resolver method.
 */
export function continueFailedTaskDb(
  db: Database,
  taskId: string,
  instruction?: string,
): void {
  const row = db
    .query(
      'SELECT agent_status, retry_count, agent_instruction FROM tasks WHERE id = ?',
    )
    .get(taskId) as {
    agent_status: string
    retry_count: number
    agent_instruction: string | null
  } | null
  if (!row) {
    throw new GraphQLError('NOT_FOUND: Task not found', {
      extensions: { code: 'NOT_FOUND' },
    })
  }
  if (row.agent_status !== 'failed') {
    throw new GraphQLError('TASK_NOT_FAILED: Task is not in FAILED state', {
      extensions: { code: 'TASK_NOT_FAILED' },
    })
  }
  const nextRetry = (row.retry_count ?? 0) + 1
  let nextInstruction = row.agent_instruction
  if (instruction && instruction.trim().length > 0) {
    nextInstruction =
      nextInstruction && nextInstruction.trim().length > 0
        ? `${nextInstruction}, ${instruction.trim()}`
        : instruction.trim()
  }
  taskLifecycleTransition({
    db,
    extras: (txDb) => {
      txDb.run(
        `UPDATE tasks
           SET retry_count = ?,
               agent_instruction = ?,
               queue_after = datetime('now', '+2 seconds')
         WHERE id = ?`,
        [nextRetry, nextInstruction, taskId],
      )
    },
    from: 'failed',
    taskId,
    to: 'queued',
  })
}
