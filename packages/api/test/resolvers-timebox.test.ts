/**
 * resolvers-timebox.test.ts
 *
 * Covers Task 17: setTimeBox / extendTimeBox / killTask mutations and
 * Task.timeBoxRemainingMs field resolver.
 *
 * Harness mirrors resolvers-dependencies.test.ts: same shared memDb injection
 * via the module-level `db` import, same seed/migrate setup per test, same
 * makeCtx() auth helper. For killTask, a stub orchestrator is registered via
 * setOrchestrator so the DB effects are exercised without a live agent process.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GraphQLError } from 'graphql'
import { db, generateId } from '../src/db'
import { migrate } from '../src/db/migrate'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { setOrchestrator } from '../src/orchestrator'
import { resolvers } from '../src/schema/resolvers'
import { getCurrentUser, makeCtx } from './helpers/fixtures'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BoardRow = { id: string }
type ColumnRow = { id: string }
type TaskDbRow = {
  id: string
  agent_status: string
  agent_error: string | null
  time_box_ms: number | null
  time_box_started_at: string | null
  block_reason: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function insertTask(
  boardId: string,
  columnId: string,
  agentStatus: 'idle' | 'queued' | 'running' | 'blocked' = 'idle',
  extra: Partial<{
    timeBoxMs: number | null
    timeBoxStartedAt: string | null
    blockReason: string | null
  }> = {},
): string {
  const user = getCurrentUser(db)
  const id = generateId()
  db.run(
    `INSERT INTO tasks (id, board_id, column_id, title, body, position, agent_status,
       time_box_ms, time_box_started_at, block_reason, created_by, updated_by)
     VALUES (?, ?, ?, ?, '', 0, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      boardId,
      columnId,
      'Test Task',
      agentStatus,
      extra.timeBoxMs ?? null,
      extra.timeBoxStartedAt ?? null,
      extra.blockReason ?? null,
      user.id,
      user.id,
    ],
  )
  return id
}

function getTaskRow(taskId: string): TaskDbRow {
  return db.query('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskDbRow
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  createTables(db)
  seed(db)
  migrate(db)
})

afterEach(() => {
  // Clear any stub orchestrator registered by tests
  setOrchestrator(null)
})

// ---------------------------------------------------------------------------
// Mutation.setTimeBox
// ---------------------------------------------------------------------------

describe('Mutation.setTimeBox', () => {
  test('sets time_box_ms to a valid value', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id)

    const result = resolvers.Mutation.setTimeBox(
      {},
      { taskId, timeBoxMs: 30_000 },
      makeCtx(db),
    )

    expect(result.id).toBe(taskId)
    const row = getTaskRow(taskId)
    expect(row.time_box_ms).toBe(30_000)
  })

  test('clears time_box_ms when null is passed', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id, 'idle', { timeBoxMs: 60_000 })

    resolvers.Mutation.setTimeBox({}, { taskId, timeBoxMs: null }, makeCtx(db))

    const row = getTaskRow(taskId)
    expect(row.time_box_ms).toBeNull()
  })

  test('throws BAD_USER_INPUT when timeBoxMs < 1000', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id)

    expect(() =>
      resolvers.Mutation.setTimeBox({}, { taskId, timeBoxMs: 500 }, makeCtx(db)),
    ).toThrow(GraphQLError)

    try {
      resolvers.Mutation.setTimeBox({}, { taskId, timeBoxMs: 500 }, makeCtx(db))
    } catch (err) {
      expect(err).toBeInstanceOf(GraphQLError)
      expect((err as GraphQLError).extensions.code).toBe('BAD_USER_INPUT')
    }
  })
})

// ---------------------------------------------------------------------------
// Mutation.extendTimeBox
// ---------------------------------------------------------------------------

describe('Mutation.extendTimeBox', () => {
  test('throws TIME_BOX_NOT_EXPIRED when task is not BLOCKED+TIMEOUT', async () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id, 'running', {
      timeBoxMs: 30_000,
    })

    let caught: unknown
    try {
      await resolvers.Mutation.extendTimeBox(
        {},
        { additionalMs: 10_000, taskId },
        makeCtx(db),
      )
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(GraphQLError)
    expect((caught as GraphQLError).extensions.code).toBe(
      'TIME_BOX_NOT_EXPIRED',
    )
  })

  test('transitions BLOCKED+TIMEOUT task to QUEUED with extended budget', async () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id, 'blocked', {
      blockReason: 'TIMEOUT',
      timeBoxMs: 30_000,
    })

    const result = await resolvers.Mutation.extendTimeBox(
      {},
      { additionalMs: 15_000, taskId },
      makeCtx(db),
    )

    expect(result.id).toBe(taskId)
    const row = getTaskRow(taskId)
    expect(row.agent_status).toBe('queued')
    expect(row.time_box_ms).toBe(45_000)
    expect(row.block_reason).toBeNull()
    expect(row.time_box_started_at).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Mutation.killTask
// ---------------------------------------------------------------------------

describe('Mutation.killTask', () => {
  test('transitions task to FAILED with agent_error via stub orchestrator', async () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id, 'running')

    // Register a stub orchestrator that performs the same DB mutations as the
    // real killTask, without requiring a live agent process.
    setOrchestrator({
      async killTask(id: string) {
        db.run(
          `UPDATE tasks SET agent_status = 'failed', agent_error = 'killed by user',
             block_reason = NULL, updated_at = datetime('now') WHERE id = ?`,
          [id],
        )
        db.run(
          `UPDATE agent_runs SET status = 'failed', error = 'killed by user',
             finished_at = datetime('now') WHERE task_id = ? AND status = 'running'`,
          [id],
        )
      },
    } as never)

    const result = await resolvers.Mutation.killTask({}, { taskId }, makeCtx(db))

    expect(result.id).toBe(taskId)
    const row = getTaskRow(taskId)
    expect(row.agent_status).toBe('failed')
    expect(row.agent_error).toBe('killed by user')
    expect(row.block_reason).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Task.timeBoxRemainingMs field resolver
// ---------------------------------------------------------------------------

describe('Task.timeBoxRemainingMs field resolver', () => {
  test('returns null when agentStatus is not RUNNING', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id, 'idle', {
      timeBoxMs: 60_000,
      timeBoxStartedAt: new Date()
        .toISOString()
        .replace('Z', '')
        .replace('T', ' '),
    })

    const row = getTaskRow(taskId)
    // Construct a mapTask-like parent object
    const parent = {
      agentStatus: 'IDLE',
      id: taskId,
      timeBoxMs: row.time_box_ms,
      timeBoxStartedAt: row.time_box_started_at,
    }

    const result = resolvers.Task.timeBoxRemainingMs(parent as never)
    expect(result).toBeNull()
  })

  test('returns positive ms remaining when RUNNING with valid timeBoxStartedAt', () => {
    const board = getBoard()
    const col = getColumn(board.id)

    // Seed a task with time_box_ms=60000, time_box_started_at=now, agent_status='running'
    const user = getCurrentUser(db)
    const taskId = generateId()
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, body, position,
         agent_status, time_box_ms, time_box_started_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, '', 0, 'running', 60000, datetime('now'), ?, ?)`,
      [taskId, board.id, col.id, 'Timed Task', user.id, user.id],
    )

    const row = getTaskRow(taskId)
    const parent = {
      agentStatus: 'RUNNING',
      id: taskId,
      timeBoxMs: row.time_box_ms,
      timeBoxStartedAt: row.time_box_started_at,
    }

    const result = resolvers.Task.timeBoxRemainingMs(parent as never)
    expect(result).not.toBeNull()
    expect(result).toBeGreaterThan(1)
    expect(result).toBeLessThanOrEqual(60_000)
  })
})
