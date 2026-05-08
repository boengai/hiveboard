import type { Database } from 'bun:sqlite'
import { generateId } from './ulid'

export type MessageAuthorType = 'human' | 'agent'
export type MessageKind = 'hint' | 'redirect' | 'question' | 'answer'

export type TaskMessageRow = {
  id: string
  taskId: string
  authorType: MessageAuthorType
  kind: MessageKind
  body: string
  deliveredAt: string | null
  createdBy: string | null
  createdAt: string
}

type DbRow = {
  id: string
  task_id: string
  author_type: MessageAuthorType
  kind: MessageKind
  body: string
  delivered_at: string | null
  created_by: string | null
  created_at: string
}

function mapMessageRow(r: DbRow): TaskMessageRow {
  return {
    authorType: r.author_type,
    body: r.body,
    createdAt: r.created_at,
    createdBy: r.created_by,
    deliveredAt: r.delivered_at,
    id: r.id,
    kind: r.kind,
    taskId: r.task_id,
  }
}

export function insertMessage(
  db: Database,
  input: {
    taskId: string
    authorType: MessageAuthorType
    kind: MessageKind
    body: string
    createdBy: string | null
  },
): string {
  const id = generateId()
  db.run(
    `INSERT INTO task_messages (id, task_id, author_type, kind, body, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.taskId,
      input.authorType,
      input.kind,
      input.body,
      input.createdBy,
    ],
  )
  return id
}

export function listMessagesForTask(
  db: Database,
  taskId: string,
): TaskMessageRow[] {
  const rows = db
    .query(
      `SELECT * FROM task_messages WHERE task_id = ? ORDER BY created_at ASC`,
    )
    .all(taskId) as DbRow[]
  return rows.map(mapMessageRow)
}

export function listUndeliveredHumanMessages(
  db: Database,
  taskId: string,
): TaskMessageRow[] {
  const rows = db
    .query(
      `SELECT * FROM task_messages
       WHERE task_id = ? AND author_type = 'human' AND delivered_at IS NULL
       ORDER BY created_at ASC`,
    )
    .all(taskId) as DbRow[]
  return rows.map(mapMessageRow)
}

export function markMessagesDelivered(db: Database, ids: string[]): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  db.run(
    `UPDATE task_messages SET delivered_at = datetime('now') WHERE id IN (${placeholders})`,
    ids,
  )
}

export function getCurrentQuestion(
  db: Database,
  taskId: string,
): TaskMessageRow | null {
  const row = db
    .query(
      `SELECT * FROM task_messages
       WHERE task_id = ? AND kind = 'question'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(taskId) as DbRow | null
  return row ? mapMessageRow(row) : null
}
