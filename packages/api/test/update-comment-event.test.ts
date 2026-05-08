import { describe, expect, spyOn, test } from 'bun:test'
import { db, generateId } from '../src/db'
import { migrate } from '../src/db/migrate'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { pubsub } from '../src/pubsub'
import { resolvers } from '../src/schema/resolvers'
import {
  getBoard as getBoardRow,
  getColumn as getColumnRow,
  getCurrentUser,
  insertTask as insertTaskShared,
} from './helpers/fixtures'

// ---------------------------------------------------------------------------
// Helpers (thin local wrappers over the shared `db` singleton)
// ---------------------------------------------------------------------------

const getBoard = () => getBoardRow(db)
const getColumn = (boardId: string) => getColumnRow(db, boardId)
const insertTask = (boardId: string, columnId: string) =>
  insertTaskShared(db, { boardId, columnId })

function insertComment(taskId: string, body: string): string {
  const user = getCurrentUser(db)
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
    migrate(db)

    const spy = spyOn(pubsub, 'publish')

    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id)
    const commentId = insertComment(taskId, 'Original body')

    // Create a mock auth context with the queen-bee user
    const user = getCurrentUser(db)
    const ctx = {
      user: {
        displayName: 'Queen Bee',
        githubId: null,
        githubUsername: null,
        id: user.id,
        role: 'super-admin',
        username: 'queen-bee',
      },
    }

    resolvers.Mutation.updateComment(
      {},
      { body: 'Edited body', id: commentId },
      ctx as never,
    )

    const calls = spy.mock.calls
    const updateCalls = calls.filter(
      (c: unknown[]) => c[0] === 'COMMENT_UPDATED',
    )
    const addedCalls = calls.filter((c: unknown[]) => c[0] === 'COMMENT_ADDED')

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]?.[1]).toBe(taskId)
    expect((updateCalls[0]?.[2] as { body: string }).body).toBe('Edited body')
    expect(addedCalls).toHaveLength(0)

    spy.mockRestore()
  })
})
