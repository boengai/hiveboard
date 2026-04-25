/**
 * Message service. Owns the multi-step DB + lifecycle + orchestrator
 * dispatch + pubsub flow for human → agent messages and the human's
 * `answerQuestion` reply. Resolvers handle only auth + GraphQL marshaling.
 *
 * See `architecture.md` §8 for the bidirectional channel transport.
 */

import { GraphQLError } from 'graphql'

import { db } from '../db'
import { insertMessage, type TaskMessageRow } from '../db/task-messages'
import { transition as taskLifecycleTransition } from '../lifecycle'
import { mapTaskRow } from '../lifecycle/task-row'
import type { TaskRow } from '../orchestrator/orchestrator'
import { publishMessageAdded, publishTaskUpdated } from '../pubsub'
import { getOrchestrator } from '../orchestrator'

const MAX_BODY_BYTES = 8 * 1024

export type MappedMessage = {
  id: string
  taskId: string
  authorType: 'HUMAN' | 'AGENT'
  kind: 'HINT' | 'REDIRECT' | 'QUESTION' | 'ANSWER'
  body: string
  deliveredAt: string | null
  createdBy: string | null
  createdAt: string
  _createdBy: string | null
}

export class EmptyMessageBodyError extends GraphQLError {
  constructor(label: string) {
    super(`${label} body cannot be empty`, {
      extensions: { code: 'BAD_USER_INPUT' },
    })
  }
}

export class MessageBodyTooLongError extends GraphQLError {
  constructor() {
    super(`Message body too long (max ${MAX_BODY_BYTES / 1024} KB)`, {
      extensions: { code: 'BAD_USER_INPUT' },
    })
  }
}

export class TaskNotBlockedError extends GraphQLError {
  constructor() {
    super('Task is not BLOCKED — no question to answer', {
      extensions: { code: 'TASK_NOT_BLOCKED' },
    })
  }
}

function mapTaskMessageRow(row: TaskMessageRow): MappedMessage {
  return {
    _createdBy: row.createdBy,
    authorType: row.authorType.toUpperCase() as 'HUMAN' | 'AGENT',
    body: row.body,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    deliveredAt: row.deliveredAt,
    id: row.id,
    kind: row.kind.toUpperCase() as 'HINT' | 'REDIRECT' | 'QUESTION' | 'ANSWER',
    taskId: row.taskId,
  }
}

function fetchMessage(id: string): MappedMessage {
  const row = db.query('SELECT * FROM task_messages WHERE id = ?').get(id) as {
    id: string
    task_id: string
    author_type: 'human' | 'agent'
    kind: 'hint' | 'redirect' | 'question' | 'answer'
    body: string
    delivered_at: string | null
    created_by: string | null
    created_at: string
  }
  return mapTaskMessageRow({
    authorType: row.author_type,
    body: row.body,
    createdAt: row.created_at,
    createdBy: row.created_by,
    deliveredAt: row.delivered_at,
    id: row.id,
    kind: row.kind,
    taskId: row.task_id,
  })
}

function validateBody(body: string, label: string): string {
  const trimmed = body.trim()
  if (trimmed.length === 0) throw new EmptyMessageBodyError(label)
  if (trimmed.length > MAX_BODY_BYTES) throw new MessageBodyTooLongError()
  return trimmed
}

export async function sendHint(input: {
  taskId: string
  body: string
  actorId: string
}): Promise<MappedMessage> {
  const trimmed = validateBody(input.body, 'Hint')

  const id = insertMessage(db, {
    authorType: 'human',
    body: trimmed,
    createdBy: input.actorId,
    kind: 'hint',
    taskId: input.taskId,
  })
  await getOrchestrator()?.dispatchHumanMessage(
    input.taskId,
    'hint',
    trimmed,
    id,
  )

  const message = fetchMessage(id)
  publishMessageAdded(input.taskId, message)
  return message
}

export async function sendRedirect(input: {
  taskId: string
  body: string
  actorId: string
}): Promise<MappedMessage> {
  const trimmed = validateBody(input.body, 'Redirect')

  const id = insertMessage(db, {
    authorType: 'human',
    body: trimmed,
    createdBy: input.actorId,
    kind: 'redirect',
    taskId: input.taskId,
  })
  await getOrchestrator()?.dispatchHumanMessage(
    input.taskId,
    'redirect',
    trimmed,
    id,
  )

  const message = fetchMessage(id)
  publishMessageAdded(input.taskId, message)

  // A redirect may have flipped agent_status; ensure UI gets a TASK_UPDATED
  // even when the orchestrator is unavailable (no-op dispatch above).
  const taskRow = db
    .query('SELECT * FROM tasks WHERE id = ?')
    .get(input.taskId) as TaskRow | null
  if (taskRow) {
    publishTaskUpdated(
      taskRow.board_id,
      mapTaskRow(taskRow) as unknown as Record<string, unknown>,
    )
  }
  return message
}

export function answerQuestion(input: {
  taskId: string
  body: string
  actorId: string
}): MappedMessage {
  const { taskId, body, actorId } = input
  const trimmed = validateBody(body, 'Answer')

  const task = db
    .query('SELECT agent_status FROM tasks WHERE id = ?')
    .get(taskId) as { agent_status: string } | null
  if (!task) {
    throw new GraphQLError(`Task ${taskId} not found`, {
      extensions: { code: 'NOT_FOUND' },
    })
  }
  if (task.agent_status !== 'blocked') throw new TaskNotBlockedError()

  let id!: string
  taskLifecycleTransition({
    blockReason: null,
    extras: (txDb) => {
      id = insertMessage(txDb, {
        authorType: 'human',
        body: trimmed,
        createdBy: actorId,
        kind: 'answer',
        taskId,
      })
      txDb.run(
        `UPDATE tasks SET
           queue_after = datetime('now', '+30 seconds'),
           verify_attempt_count = 0,
           pending_auto_revise_source_run_id = NULL
         WHERE id = ?`,
        [taskId],
      )
    },
    from: 'blocked',
    taskId,
    to: 'queued',
  })

  const message = fetchMessage(id)
  publishMessageAdded(taskId, message)
  return message
}
