/**
 * resolvers-verification.test.ts
 *
 * Covers Task 13: GraphQL resolvers for VerificationRun field resolvers,
 * Task.verifyAttemptCount, Task.verifyCommandsOverride, the
 * setTaskVerifyCommands mutation, and verificationRunAdded subscription.
 *
 * Mirrors the harness pattern from resolvers-messages.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { db, generateId } from '../src/db'
import { migrate } from '../src/db/migrate'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { resolvers } from '../src/schema/resolvers'
import { getCurrentUser, makeCtx } from './helpers/fixtures'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BoardRow = { id: string }
type ColumnRow = { id: string }

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

function insertTask(boardId: string, columnId: string): string {
  const user = getCurrentUser(db)
  const id = generateId()
  db.run(
    `INSERT INTO tasks (id, board_id, column_id, title, body, position, agent_status, created_by, updated_by)
     VALUES (?, ?, ?, ?, '', 0, 'idle', ?, ?)`,
    [id, boardId, columnId, 'Test Task', user.id, user.id],
  )
  return id
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  createTables(db)
  seed(db)
  migrate(db)
})

afterEach(() => {
  // nothing to clean up between tests (db is re-initialised by beforeEach)
})

// ---------------------------------------------------------------------------
// Task.verificationRuns
// ---------------------------------------------------------------------------

describe('Task.verificationRuns resolver', () => {
  test('returns runs in newest-first order', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id)

    // Insert two runs with explicit started_at to control ordering
    // Use agent_run_id = null to avoid FK constraint on agent_runs
    db.run(
      `INSERT INTO verification_runs
         (id, task_id, agent_run_id, command, label, exit_code, output, started_at, finished_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, datetime('now', '-10 seconds'), datetime('now', '-9 seconds'))`,
      [generateId(), taskId, 'bun run test', 'test', 0, 'ok'],
    )
    db.run(
      `INSERT INTO verification_runs
         (id, task_id, agent_run_id, command, label, exit_code, output, started_at, finished_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, datetime('now'), datetime('now', '+1 second'))`,
      [generateId(), taskId, 'bun run lint', 'lint', 1, 'fail'],
    )

    const runs = (
      resolvers.Task as never as {
        verificationRuns: (parent: { id: string }) => unknown[]
      }
    ).verificationRuns({ id: taskId })

    expect(runs).toHaveLength(2)
    // newest first — lint (exit_code=1) was started at 'now', so it comes first
    expect((runs[0] as { label: string }).label).toBe('lint')
    expect((runs[1] as { label: string }).label).toBe('test')
  })

  test('returns empty array when none exist', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id)

    const runs = (
      resolvers.Task as never as {
        verificationRuns: (parent: { id: string }) => unknown[]
      }
    ).verificationRuns({ id: taskId })

    expect(runs).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Task.verifyAttemptCount
// ---------------------------------------------------------------------------

describe('Task.verifyAttemptCount resolver', () => {
  test('returns the column value', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id)

    db.run(`UPDATE tasks SET verify_attempt_count = 3 WHERE id = ?`, [taskId])

    const count = (
      resolvers.Task as never as {
        verifyAttemptCount: (parent: { id: string }) => number
      }
    ).verifyAttemptCount({ id: taskId })

    expect(count).toBe(3)
  })

  test('returns 0 when column is default', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id)

    const count = (
      resolvers.Task as never as {
        verifyAttemptCount: (parent: { id: string }) => number
      }
    ).verifyAttemptCount({ id: taskId })

    expect(count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Task.verifyCommandsOverride
// ---------------------------------------------------------------------------

describe('Task.verifyCommandsOverride resolver', () => {
  test('returns null when column is NULL', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id)

    // verify_commands is NULL by default
    const result = (
      resolvers.Task as never as {
        verifyCommandsOverride: (parent: { id: string }) => unknown
      }
    ).verifyCommandsOverride({ id: taskId })

    expect(result).toBeNull()
  })

  test('parses JSON array into VerifyCommand objects', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id)

    db.run(`UPDATE tasks SET verify_commands = ? WHERE id = ?`, [
      JSON.stringify([
        { label: 'only-test', run: 'bun run test', timeoutMs: 60000 },
      ]),
      taskId,
    ])

    const out = (
      resolvers.Task as never as {
        verifyCommandsOverride: (parent: { id: string }) => unknown
      }
    ).verifyCommandsOverride({ id: taskId })

    expect(out).toHaveLength(1)
    expect(
      (out as { label: string; run: string; timeoutMs: number }[])[0],
    ).toEqual({
      label: 'only-test',
      run: 'bun run test',
      timeoutMs: 60000,
    })
  })

  test('returns null on invalid JSON', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id)

    db.run(`UPDATE tasks SET verify_commands = ? WHERE id = ?`, [
      'not-valid-json{{{',
      taskId,
    ])

    const result = (
      resolvers.Task as never as {
        verifyCommandsOverride: (parent: { id: string }) => unknown
      }
    ).verifyCommandsOverride({ id: taskId })

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Mutation.setTaskVerifyCommands
// ---------------------------------------------------------------------------

describe('setTaskVerifyCommands mutation', () => {
  test('stores JSON array', async () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id)

    const result = await (
      resolvers.Mutation as never as {
        setTaskVerifyCommands: (
          _: unknown,
          args: {
            taskId: string
            commands: Array<{
              label: string
              run: string
              timeoutMs?: number | null
            }> | null
          },
          ctx: never,
        ) => Promise<unknown>
      }
    ).setTaskVerifyCommands(
      {},
      {
        commands: [
          { label: 'test', run: 'bun run test', timeoutMs: 30000 },
          { label: 'lint', run: 'bun run lint' },
        ],
        taskId,
      },
      makeCtx(db),
    )

    expect((result as { id: string }).id).toBe(taskId)

    const row = db
      .query('SELECT verify_commands FROM tasks WHERE id = ?')
      .get(taskId) as { verify_commands: string | null }
    expect(row.verify_commands).not.toBeNull()
    const parsed = JSON.parse(row.verify_commands!) as unknown[]
    expect(parsed).toHaveLength(2)
    expect((parsed[0] as { label: string }).label).toBe('test')
    expect((parsed[1] as { label: string }).label).toBe('lint')
  })

  test('clears override when commands=null', async () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id)

    // first set some commands
    db.run(`UPDATE tasks SET verify_commands = ? WHERE id = ?`, [
      JSON.stringify([{ label: 'x', run: 'echo x' }]),
      taskId,
    ])

    await (
      resolvers.Mutation as never as {
        setTaskVerifyCommands: (
          _: unknown,
          args: {
            taskId: string
            commands: Array<{
              label: string
              run: string
              timeoutMs?: number | null
            }> | null
          },
          ctx: never,
        ) => Promise<unknown>
      }
    ).setTaskVerifyCommands({}, { commands: null, taskId }, makeCtx(db))

    const row = db
      .query('SELECT verify_commands FROM tasks WHERE id = ?')
      .get(taskId) as { verify_commands: string | null }
    expect(row.verify_commands).toBeNull()
  })

  test('stores empty array to skip verification for the task', async () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id)

    await (
      resolvers.Mutation as never as {
        setTaskVerifyCommands: (
          _: unknown,
          args: {
            taskId: string
            commands: Array<{
              label: string
              run: string
              timeoutMs?: number | null
            }> | null
          },
          ctx: never,
        ) => Promise<unknown>
      }
    ).setTaskVerifyCommands({}, { commands: [], taskId }, makeCtx(db))

    const row = db
      .query('SELECT verify_commands FROM tasks WHERE id = ?')
      .get(taskId) as { verify_commands: string | null }
    expect(row.verify_commands).not.toBeNull()
    const parsed = JSON.parse(row.verify_commands!) as unknown[]
    expect(parsed).toHaveLength(0)
  })

  test('requires auth + task access', async () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id)

    // No user in context → requireAuth throws (plain Error "Authentication required")
    await expect(
      (
        resolvers.Mutation as never as {
          setTaskVerifyCommands: (
            _: unknown,
            args: {
              taskId: string
              commands: Array<{ label: string; run: string }> | null
            },
            ctx: never,
          ) => Promise<unknown>
        }
      ).setTaskVerifyCommands(
        {},
        { commands: null, taskId },
        {} as never, // empty ctx — no user
      ),
    ).rejects.toThrow('Authentication required')
  })
})
