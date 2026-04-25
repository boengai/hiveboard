import { unlink } from 'node:fs/promises'
import { consola } from 'consola'

import { db } from '../../db'
import { insertMessage } from '../../db/task-messages'
import { transition as taskLifecycleTransition } from '../../lifecycle'
import { publishMessageAdded } from '../../pubsub'
import { questionPath } from '../../workspace/agent-state'
import type { OutcomeDeps } from './shared'

/**
 * RUNNING → BLOCKED (QUESTION). The agent wrote to `$HIVEBOARD_QUESTION`
 * before exiting. Capture the question as a `task_messages` row, mark
 * the run blocked, then unlink the file so the next run doesn't
 * re-trigger BLOCKED on stale contents.
 */
export async function applyQuestion(
  deps: OutcomeDeps,
  question: string,
): Promise<void> {
  const { task, runId, result, config } = deps

  let msgId!: string
  taskLifecycleTransition({
    blockReason: 'QUESTION',
    event: {
      actor: 'SYSTEM',
      data: { question_preview: question.slice(0, 120) },
      type: 'agent_blocked',
    },
    extras: (txDb) => {
      msgId = insertMessage(txDb, {
        authorType: 'agent',
        body: question,
        createdBy: null,
        kind: 'question',
        taskId: task.id,
      })
      txDb.run(
        `UPDATE agent_runs SET status = 'blocked', finished_at = datetime('now'), error = ? WHERE id = ?`,
        [result.error ?? null, runId],
      )
    },
    taskId: task.id,
    to: 'blocked',
    db,
  })

  const row = db
    .query('SELECT * FROM task_messages WHERE id = ?')
    .get(msgId) as Record<string, unknown>
  publishMessageAdded(task.id, {
    authorType: 'AGENT',
    body: row.body,
    createdAt: row.created_at,
    createdBy: null,
    deliveredAt: row.delivered_at,
    id: row.id,
    kind: 'QUESTION',
    taskId: row.task_id,
  })

  try {
    await unlink(questionPath(config, task.id))
  } catch {
    // ignore — file may already be gone
  }

  consola.info(`Task ${task.id} BLOCKED on agent question`)
}
