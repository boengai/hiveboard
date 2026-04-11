import { describe, expect, spyOn, test } from 'bun:test'
import { db, generateId } from '../src/db'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { pubsub } from '../src/pubsub'
import { resolvers } from '../src/schema/resolvers'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UserRow = { id: string; username: string }
type BoardRow = { id: string }
type ColumnRow = { id: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCurrentUser(): UserRow {
  return db
    .query('SELECT * FROM users WHERE username = ?')
    .get('queen-bee') as UserRow
}

function getBoard(): BoardRow {
  return db.query('SELECT id FROM boards LIMIT 1').get() as BoardRow
}

function getColumn(boardId: string): ColumnRow {
  return db
    .query(
      'SELECT id FROM columns WHERE board_id = ? ORDER BY position ASC LIMIT 1',
    )
    .get(boardId) as ColumnRow
}

function insertTask(boardId: string, columnId: string): string {
  const user = getCurrentUser()
  const id = generateId()
  db.run(
    `INSERT INTO tasks (id, board_id, column_id, title, body, position, created_by, updated_by)
     VALUES (?, ?, ?, ?, '', 0, ?, ?)`,
    [id, boardId, columnId, 'Test Task', user.id, user.id],
  )
  return id
}

function insertComment(taskId: string, body: string): string {
  const user = getCurrentUser()
  const id = generateId()
  db.run(
    'INSERT INTO task_comments (id, task_id, parent_id, body, created_by) VALUES (?, ?, ?, ?, ?)',
    [id, taskId, null, body, user.id],
  )
  return id
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('updateComment pubsub event', () => {
  test('publishes to COMMENT_UPDATED, not COMMENT_ADDED', () => {
    // Ensure tables and seed data exist in the singleton db
    createTables(db)
    seed(db)

    const spy = spyOn(pubsub, 'publish')

    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id)
    const commentId = insertComment(taskId, 'Original body')

    resolvers.Mutation.updateComment({}, { id: commentId, body: 'Edited body' })

    const calls = spy.mock.calls
    const updateCalls = calls.filter(
      (c: unknown[]) => c[0] === 'COMMENT_UPDATED',
    )
    const addedCalls = calls.filter(
      (c: unknown[]) => c[0] === 'COMMENT_ADDED',
    )

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]?.[1]).toBe(taskId)
    expect((updateCalls[0]?.[2] as { body: string }).body).toBe('Edited body')
    expect(addedCalls).toHaveLength(0)

    spy.mockRestore()
  })
})
