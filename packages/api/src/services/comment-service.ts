/**
 * Comment service. Owns the multi-step DB + pubsub flow for comment
 * mutations; resolvers stay thin and own only auth + GraphQL marshaling.
 */

import { db, generateId } from '../db'
import { pubsub } from '../pubsub'

type CommentRow = {
  id: string
  task_id: string
  parent_id: string | null
  body: string
  created_by: string
  created_at: string
  updated_at: string
}

export type MappedComment = {
  _createdBy: string
  _taskId: string
  body: string
  createdAt: string
  id: string
  parentId: string | null
  updatedAt: string
}

function mapCommentRow(row: CommentRow): MappedComment {
  return {
    _createdBy: row.created_by,
    _taskId: row.task_id,
    body: row.body,
    createdAt: row.created_at,
    id: row.id,
    parentId: row.parent_id,
    updatedAt: row.updated_at,
  }
}

function fetchTaskEventForPublish(eventId: string): {
  id: string
  type: string
  data: string | null
  created_at: string
  actor: string
} | null {
  return db
    .query('SELECT * FROM task_events WHERE id = ?')
    .get(eventId) as {
    id: string
    type: string
    data: string | null
    created_at: string
    actor: string
  } | null
}

function publishTaskEventRow(taskId: string, eventId: string): void {
  const ev = fetchTaskEventForPublish(eventId)
  if (!ev) return
  pubsub.publish('TASK_EVENT', taskId, {
    _actor: ev.actor,
    createdAt: ev.created_at,
    data: ev.data,
    id: ev.id,
    isSystem: false,
    type: ev.type,
  } as unknown as Record<string, unknown>)
}

export class CommentDepthError extends Error {
  constructor() {
    super('Cannot nest replies more than 1 level deep')
  }
}

export class CommentNotFoundError extends Error {
  constructor(id: string) {
    super(`Comment ${id} not found`)
  }
}

export function addComment(input: {
  taskId: string
  body: string
  parentId?: string | null
  actorId: string
}): MappedComment {
  const { taskId, body, parentId, actorId } = input

  if (parentId) {
    const parent = db
      .query('SELECT parent_id FROM task_comments WHERE id = ?')
      .get(parentId) as { parent_id: string | null } | null
    if (!parent) throw new CommentNotFoundError(parentId)
    if (parent.parent_id !== null) throw new CommentDepthError()
  }

  const id = generateId()
  const eventId = generateId()

  db.transaction(() => {
    db.run(
      'INSERT INTO task_comments (id, task_id, parent_id, body, created_by) VALUES (?, ?, ?, ?, ?)',
      [id, taskId, parentId ?? null, body, actorId],
    )
    db.run(
      'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
      [
        eventId,
        taskId,
        actorId,
        'comment_added',
        JSON.stringify({ comment_id: id }),
      ],
    )
  })()

  const row = db
    .query('SELECT * FROM task_comments WHERE id = ?')
    .get(id) as CommentRow
  const comment = mapCommentRow(row)

  pubsub.publish(
    'COMMENT_ADDED',
    taskId,
    comment as unknown as Record<string, unknown>,
  )
  publishTaskEventRow(taskId, eventId)

  return comment
}

export function updateComment(input: {
  id: string
  body: string
}): MappedComment {
  const { id, body } = input
  db.run(
    `UPDATE task_comments SET body = ?, updated_at = datetime('now') WHERE id = ?`,
    [body, id],
  )
  const row = db
    .query('SELECT * FROM task_comments WHERE id = ?')
    .get(id) as CommentRow
  const comment = mapCommentRow(row)

  pubsub.publish(
    'COMMENT_UPDATED',
    row.task_id,
    comment as unknown as Record<string, unknown>,
  )
  return comment
}

export function deleteComment(input: {
  id: string
  actorId: string
}): boolean {
  const { id, actorId } = input
  const existing = db
    .query('SELECT * FROM task_comments WHERE id = ?')
    .get(id) as CommentRow | null
  if (!existing) throw new CommentNotFoundError(id)

  const eventId = generateId()

  db.transaction(() => {
    db.run(
      'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
      [
        eventId,
        existing.task_id,
        actorId,
        'comment_deleted',
        JSON.stringify({ comment_id: id }),
      ],
    )
    db.run('DELETE FROM task_comments WHERE id = ?', [id])
  })()

  publishTaskEventRow(existing.task_id, eventId)

  return true
}
