/**
 * Tests for `taskLifecycle.transition` — the Task Lifecycle module that
 * is the only sanctioned writer of `tasks.agent_status` outside of seed
 * migrations.
 */

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { generateId } from '../src/db/ulid'

const memDb = new Database(':memory:')
memDb.exec('PRAGMA journal_mode = WAL')
memDb.exec('PRAGMA foreign_keys = ON')
createTables(memDb)
seed(memDb)

const captured: {
  taskUpdated: Array<{ boardId: string; payload: Record<string, unknown> }>
  taskEvents: Array<{ taskId: string; payload: Record<string, unknown> }>
} = { taskEvents: [], taskUpdated: [] }

mock.module('../src/db', () => ({
  db: memDb,
  generateId,
}))

mock.module('../src/pubsub', () => ({
  publishAgentLog: () => {},
  publishCheckpointAdded: () => {},
  publishCommentAdded: () => {},
  publishCommentUpdated: () => {},
  publishMessageAdded: () => {},
  publishScratchpadUpdated: () => {},
  publishTaskEvent: () => {},
  publishTaskMissingSecretsChanged: () => {},
  publishTaskProgress: () => {},
  publishTaskUpdated: (boardId: string, payload: Record<string, unknown>) => {
    captured.taskUpdated.push({ boardId, payload })
  },
  publishVerificationRun: () => {},
  publishWorkspaceSnapshot: () => {},
  pubsub: {
    publish: (
      topic: string,
      taskId: string,
      payload: Record<string, unknown>,
    ) => {
      if (topic === 'TASK_EVENT') captured.taskEvents.push({ payload, taskId })
    },
  },
}))

const {
  IllegalLifecycleEdgeError,
  transition,
} = await import('../src/lifecycle')

function seedTask(status: string): {
  taskId: string
  boardId: string
} {
  const user = memDb.query('SELECT id FROM users LIMIT 1').get() as {
    id: string
  }
  const board = memDb.query('SELECT id FROM boards LIMIT 1').get() as {
    id: string
  }
  const col = memDb.query('SELECT id FROM columns LIMIT 1').get() as {
    id: string
  }
  const id = generateId()
  memDb.run(
    `INSERT INTO tasks (id, board_id, column_id, title, body, agent_status, retry_count, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [id, board.id, col.id, 'Lifecycle Test', '', status, user.id, user.id],
  )
  return { boardId: board.id, taskId: id }
}

beforeEach(() => {
  captured.taskUpdated = []
  captured.taskEvents = []
})

afterEach(() => {
  memDb.run("DELETE FROM tasks WHERE title = 'Lifecycle Test'")
  memDb.run('DELETE FROM agent_runs')
  memDb.run("DELETE FROM task_events WHERE actor = 'SYSTEM'")
})

describe('taskLifecycle.transition', () => {
  it('updates agent_status and publishes TASK_UPDATED on a valid edge', () => {
    const { taskId, boardId } = seedTask('queued')

    const result = transition({ taskId, to: 'running' })

    const row = memDb
      .query('SELECT agent_status, block_reason FROM tasks WHERE id = ?')
      .get(taskId) as { agent_status: string; block_reason: string | null }
    expect(row.agent_status).toBe('running')
    expect(row.block_reason).toBeNull()

    expect(result.fromStatus).toBe('queued')
    expect(result.toStatus).toBe('running')
    expect(result.boardId).toBe(boardId)

    expect(captured.taskUpdated).toHaveLength(1)
    expect(captured.taskUpdated[0]?.boardId).toBe(boardId)
    expect(captured.taskUpdated[0]?.payload.agentStatus).toBe('RUNNING')
  })

  it('rejects an undocumented edge with IllegalLifecycleEdgeError', () => {
    const { taskId } = seedTask('queued')

    expect(() => transition({ taskId, to: 'success' })).toThrow(
      IllegalLifecycleEdgeError,
    )

    const row = memDb
      .query('SELECT agent_status FROM tasks WHERE id = ?')
      .get(taskId) as { agent_status: string }
    expect(row.agent_status).toBe('queued')
    expect(captured.taskUpdated).toHaveLength(0)
  })

  it('allows an undocumented edge when force=true', () => {
    const { taskId } = seedTask('queued')

    transition({ force: true, taskId, to: 'success' })

    const row = memDb
      .query('SELECT agent_status FROM tasks WHERE id = ?')
      .get(taskId) as { agent_status: string }
    expect(row.agent_status).toBe('success')
  })

  it('throws when `from` assertion does not match', () => {
    const { taskId } = seedTask('queued')

    expect(() =>
      transition({ from: 'running', taskId, to: 'success' }),
    ).toThrow(/expected from=running/)
  })

  it('sets block_reason when transitioning to blocked', () => {
    const { taskId } = seedTask('running')

    transition({
      blockReason: 'QUESTION',
      taskId,
      to: 'blocked',
    })

    const row = memDb
      .query('SELECT agent_status, block_reason FROM tasks WHERE id = ?')
      .get(taskId) as { agent_status: string; block_reason: string | null }
    expect(row.agent_status).toBe('blocked')
    expect(row.block_reason).toBe('QUESTION')
  })

  it('clears block_reason when blockReason=null is passed', () => {
    const { taskId } = seedTask('running')

    transition({ blockReason: 'TIMEOUT', taskId, to: 'blocked' })
    transition({ blockReason: null, taskId, to: 'queued' })

    const row = memDb
      .query('SELECT agent_status, block_reason FROM tasks WHERE id = ?')
      .get(taskId) as { agent_status: string; block_reason: string | null }
    expect(row.agent_status).toBe('queued')
    expect(row.block_reason).toBeNull()
  })

  it('writes a task_events row and publishes TASK_EVENT when event is given', () => {
    const { taskId } = seedTask('running')

    transition({
      event: {
        actor: 'SYSTEM',
        data: { question_preview: 'hi?' },
        type: 'agent_blocked',
      },
      blockReason: 'QUESTION',
      taskId,
      to: 'blocked',
    })

    const ev = memDb
      .query(
        `SELECT actor, type, data FROM task_events
           WHERE task_id = ? AND type = 'agent_blocked'`,
      )
      .get(taskId) as { actor: string; type: string; data: string | null }
    expect(ev.actor).toBe('SYSTEM')
    expect(ev.data).toBe(JSON.stringify({ question_preview: 'hi?' }))

    expect(captured.taskEvents).toHaveLength(1)
    expect(captured.taskEvents[0]?.taskId).toBe(taskId)
    expect(captured.taskEvents[0]?.payload.type).toBe('agent_blocked')
    expect(captured.taskEvents[0]?.payload.isSystem).toBe(true)
  })

  it('runs `extras` inside the same transaction; rolls back on throw', () => {
    const { taskId } = seedTask('queued')

    expect(() =>
      transition({
        extras: () => {
          throw new Error('boom')
        },
        taskId,
        to: 'running',
      }),
    ).toThrow(/boom/)

    const row = memDb
      .query('SELECT agent_status FROM tasks WHERE id = ?')
      .get(taskId) as { agent_status: string }
    expect(row.agent_status).toBe('queued')
    expect(captured.taskUpdated).toHaveLength(0)
  })

  it('runs `extras` SQL atomically with the status update', () => {
    const { taskId } = seedTask('running')

    transition({
      extras: (db) => {
        db.run('UPDATE tasks SET agent_output = ? WHERE id = ?', [
          'all good',
          taskId,
        ])
      },
      taskId,
      to: 'success',
    })

    const row = memDb
      .query(
        'SELECT agent_status, agent_output FROM tasks WHERE id = ?',
      )
      .get(taskId) as { agent_status: string; agent_output: string | null }
    expect(row.agent_status).toBe('success')
    expect(row.agent_output).toBe('all good')
  })
})
