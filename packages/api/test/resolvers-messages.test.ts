/**
 * resolvers-messages.test.ts
 *
 * Covers Task 9 of the bidirectional-channel plan: GraphQL resolvers for
 * sendHint, sendRedirect, answerQuestion, Task.messages, Task.currentQuestion.
 *
 * Strategy mirrors update-comment-event.test.ts — the singleton `db` is
 * initialised with tables/seed and resolvers are called directly. The
 * orchestrator is injected via setOrchestrator with a stub that records
 * dispatchHumanMessage calls so we can assert the wiring without spinning
 * up real agent processes.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GraphQLError } from 'graphql'
import { db, generateId } from '../src/db'
import { migrate } from '../src/db/migrate'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { setOrchestrator } from '../src/orchestrator'
import type { Orchestrator } from '../src/orchestrator/orchestrator'
import { resolvers } from '../src/schema/resolvers'
import {
  getBoard as getBoardRow,
  getColumn as getColumnRow,
  insertTask as insertTaskShared,
  makeCtx,
} from './helpers/fixtures'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TaskRow = {
  id: string
  agent_status: string
  queue_after: string | null
}
type MessageRow = {
  id: string
  task_id: string
  author_type: string
  kind: string
  body: string
  created_by: string | null
}

// ---------------------------------------------------------------------------
// Helpers (thin local wrappers over the shared `db` singleton)
// ---------------------------------------------------------------------------

const getBoard = () => getBoardRow(db)
const getColumn = (boardId: string) => getColumnRow(db, boardId)
const insertTask = (
  boardId: string,
  columnId: string,
  agentStatus: 'idle' | 'queued' | 'running' | 'blocked' = 'idle',
) => insertTaskShared(db, { agentStatus, boardId, columnId })

function insertQuestion(taskId: string, body: string): string {
  const id = generateId()
  db.run(
    `INSERT INTO task_messages (id, task_id, author_type, kind, body, created_by)
     VALUES (?, ?, 'agent', 'question', ?, NULL)`,
    [id, taskId, body],
  )
  return id
}

type DispatchCall = {
  taskId: string
  kind: 'hint' | 'redirect' | 'answer'
  body: string
  messageId?: string
}

function installOrchestratorStub(): DispatchCall[] {
  const calls: DispatchCall[] = []
  const stub = {
    dispatchHumanMessage: async (
      taskId: string,
      kind: 'hint' | 'redirect' | 'answer',
      body: string,
      messageId?: string,
    ) => {
      calls.push({ body, kind, messageId, taskId })
    },
  } as unknown as Orchestrator
  setOrchestrator(stub)
  return calls
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
  setOrchestrator(null)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Mutation.sendHint', () => {
  test('creates a hint message and calls dispatchHumanMessage(kind=hint)', async () => {
    const dispatchCalls = installOrchestratorStub()
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id, 'running')

    const message = await resolvers.Mutation.sendHint(
      {},
      { body: '  use the new API  ', taskId },
      makeCtx(db),
    )

    expect(message.kind).toBe('HINT')
    expect(message.authorType).toBe('HUMAN')
    // body is trimmed before persisting
    expect(message.body).toBe('use the new API')
    expect(message.taskId).toBe(taskId)

    // Row was persisted
    const row = db
      .query('SELECT * FROM task_messages WHERE id = ?')
      .get(message.id) as MessageRow
    expect(row.kind).toBe('hint')
    expect(row.author_type).toBe('human')
    expect(row.body).toBe('use the new API')

    // dispatchHumanMessage was called
    expect(dispatchCalls).toHaveLength(1)
    expect(dispatchCalls[0]?.kind).toBe('hint')
    expect(dispatchCalls[0]?.body).toBe('use the new API')
    expect(dispatchCalls[0]?.taskId).toBe(taskId)
  })

  test('throws BAD_USER_INPUT when body is blank', async () => {
    installOrchestratorStub()
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id, 'running')

    await expect(
      resolvers.Mutation.sendHint({}, { body: '   ', taskId }, makeCtx(db)),
    ).rejects.toThrow(GraphQLError)

    // No row inserted
    const rows = db
      .query('SELECT id FROM task_messages WHERE task_id = ?')
      .all(taskId) as Array<{ id: string }>
    expect(rows).toHaveLength(0)
  })

  test('rejects bodies larger than 8 KB', async () => {
    installOrchestratorStub()
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id, 'running')
    const huge = 'x'.repeat(8 * 1024 + 1)

    await expect(
      resolvers.Mutation.sendHint({}, { body: huge, taskId }, makeCtx(db)),
    ).rejects.toThrow(/too long/i)

    // No row inserted
    const rows = db
      .query('SELECT id FROM task_messages WHERE task_id = ?')
      .all(taskId) as Array<{ id: string }>
    expect(rows).toHaveLength(0)
  })
})

describe('Mutation.sendRedirect', () => {
  test('creates a redirect message and dispatches with kind=redirect', async () => {
    const dispatchCalls = installOrchestratorStub()
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id, 'running')

    const message = await resolvers.Mutation.sendRedirect(
      {},
      { body: 'pivot to plan B', taskId },
      makeCtx(db),
    )

    expect(message.kind).toBe('REDIRECT')
    expect(message.authorType).toBe('HUMAN')

    const row = db
      .query('SELECT * FROM task_messages WHERE id = ?')
      .get(message.id) as MessageRow
    expect(row.kind).toBe('redirect')

    expect(dispatchCalls).toHaveLength(1)
    expect(dispatchCalls[0]?.kind).toBe('redirect')
    expect(dispatchCalls[0]?.body).toBe('pivot to plan B')
  })

  test('rejects bodies larger than 8 KB', async () => {
    installOrchestratorStub()
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id, 'running')
    const huge = 'x'.repeat(8 * 1024 + 1)

    await expect(
      resolvers.Mutation.sendRedirect({}, { body: huge, taskId }, makeCtx(db)),
    ).rejects.toThrow(/too long/i)

    const rows = db
      .query('SELECT id FROM task_messages WHERE task_id = ?')
      .all(taskId) as Array<{ id: string }>
    expect(rows).toHaveLength(0)
  })
})

describe('Mutation.answerQuestion', () => {
  test('inserts answer + transitions task to queued with +30s grace when BLOCKED', () => {
    installOrchestratorStub()
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id, 'blocked')
    insertQuestion(taskId, 'Which config should I use?')

    const message = resolvers.Mutation.answerQuestion(
      {},
      { body: 'Use the staging config', taskId },
      makeCtx(db),
    )

    expect(message.kind).toBe('ANSWER')
    expect(message.authorType).toBe('HUMAN')
    expect(message.body).toBe('Use the staging config')

    const row = db
      .query('SELECT * FROM task_messages WHERE id = ?')
      .get(message.id) as MessageRow
    expect(row.kind).toBe('answer')
    expect(row.author_type).toBe('human')

    // Task transitioned to queued with queue_after set in the future
    const task = db
      .query('SELECT agent_status, queue_after FROM tasks WHERE id = ?')
      .get(taskId) as TaskRow
    expect(task.agent_status).toBe('queued')
    expect(task.queue_after).not.toBeNull()

    // queue_after should be roughly 30 seconds in the future
    const qa = new Date(`${task.queue_after}Z`).getTime()
    const now = Date.now()
    expect(qa - now).toBeGreaterThan(20_000)
    expect(qa - now).toBeLessThan(40_000)

    // block_reason is cleared
    const blockRow = db
      .query('SELECT block_reason FROM tasks WHERE id = ?')
      .get(taskId) as { block_reason: string | null } | null
    expect(blockRow?.block_reason).toBeNull()
  })

  test('throws TASK_NOT_BLOCKED when task is not BLOCKED', () => {
    installOrchestratorStub()
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id, 'idle')

    expect(() =>
      resolvers.Mutation.answerQuestion(
        {},
        { body: 'I have an answer', taskId },
        makeCtx(db),
      ),
    ).toThrow(GraphQLError)

    const rows = db
      .query('SELECT id FROM task_messages WHERE task_id = ?')
      .all(taskId) as Array<{ id: string }>
    expect(rows).toHaveLength(0)
  })

  test('rejects bodies larger than 8 KB', () => {
    installOrchestratorStub()
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id, 'blocked')
    insertQuestion(taskId, 'Which config should I use?')
    const huge = 'x'.repeat(8 * 1024 + 1)

    expect(() =>
      resolvers.Mutation.answerQuestion(
        {},
        { body: huge, taskId },
        makeCtx(db),
      ),
    ).toThrow(/too long/i)

    // Only the seeded question row exists; no answer was persisted.
    const rows = db
      .query(
        "SELECT id FROM task_messages WHERE task_id = ? AND kind = 'answer'",
      )
      .all(taskId) as Array<{ id: string }>
    expect(rows).toHaveLength(0)
  })
})

describe('Task.messages field resolver', () => {
  test('returns messages ordered by created_at ASC', async () => {
    installOrchestratorStub()
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id, 'running')

    // Insert three messages — a hint, a question, then an answer-style hint.
    // The resolver should list them in insertion order (ASC by created_at).
    await resolvers.Mutation.sendHint(
      {},
      { body: 'first hint', taskId },
      makeCtx(db),
    )
    insertQuestion(taskId, 'a question')
    await resolvers.Mutation.sendHint(
      {},
      { body: 'second hint', taskId },
      makeCtx(db),
    )

    const messages = resolvers.Task.messages({ id: taskId } as never)
    expect(messages).toHaveLength(3)
    expect(messages[0]?.body).toBe('first hint')
    expect(messages[1]?.body).toBe('a question')
    expect(messages[1]?.kind).toBe('QUESTION')
    expect(messages[1]?.authorType).toBe('AGENT')
    expect(messages[2]?.body).toBe('second hint')
  })
})

describe('Task.currentQuestion field resolver', () => {
  test('returns the most recent question when one exists', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id, 'blocked')
    insertQuestion(taskId, 'older question')
    // Insert a slightly newer one with explicit created_at so ORDER BY DESC picks it.
    const newerId = generateId()
    db.run(
      `INSERT INTO task_messages (id, task_id, author_type, kind, body, created_at)
       VALUES (?, ?, 'agent', 'question', ?, datetime('now', '+1 second'))`,
      [newerId, taskId, 'newest question'],
    )

    const q = resolvers.Task.currentQuestion({ id: taskId } as never)
    expect(q).not.toBeNull()
    expect(q?.body).toBe('newest question')
    expect(q?.kind).toBe('QUESTION')
  })

  test('returns null when no question exists', () => {
    const board = getBoard()
    const col = getColumn(board.id)
    const taskId = insertTask(board.id, col.id, 'idle')

    const q = resolvers.Task.currentQuestion({ id: taskId } as never)
    expect(q).toBeNull()
  })
})
