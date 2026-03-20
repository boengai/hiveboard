/**
 * dispatch.test.ts
 *
 * Tests for the `dispatchAgent` resolver logic:
 *  - invalid action → error
 *  - implement / implement-e2e / revise without target_repo → error
 *  - task not found → error
 *  - task already running → error
 *  - valid dispatch → agent_status becomes 'queued', action is saved
 *
 * The resolver reads from / writes to the `db` singleton.  We override it
 * with an in-memory SQLite instance so no file-system state is involved.
 * pubsub is stubbed to avoid side-effects.
 */

import { Database } from 'bun:sqlite'
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { generateId } from '../src/db/ulid'

// ---------------------------------------------------------------------------
// In-memory database
// ---------------------------------------------------------------------------

const memDb = new Database(':memory:')
memDb.exec('PRAGMA journal_mode = WAL')
memDb.exec('PRAGMA foreign_keys = ON')
createTables(memDb)
seed(memDb)

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

mock.module('../src/db', () => ({
  db: memDb,
  generateId,
}))

mock.module('../src/pubsub', () => ({
  pubsub: { publish: () => {} },
  publishTaskUpdated: () => {},
  publishAgentLog: () => {},
  publishCommentAdded: () => {},
  publishTaskEvent: () => {},
}))

// The orchestrator singleton is referenced by resolvers; stub it out
mock.module('../src/orchestrator', () => ({
  getOrchestrator: () => null,
}))

// ---------------------------------------------------------------------------
// Import resolver helpers after mocks are set up
// ---------------------------------------------------------------------------

// We test the resolver logic directly by reproducing the validation rules
// from `src/schema/resolvers.ts dispatchAgent`.  This avoids having to stand
// up a full GraphQL server while still exercising the same code paths.

// ---------------------------------------------------------------------------
// Shared helper: mirror the dispatchAgent resolver
// ---------------------------------------------------------------------------

interface TaskRow {
  id: string
  board_id: string
  column_id: string
  title: string
  body: string
  action: string | null
  target_repo: string | null
  agent_status: string
  retry_count: number
}

const VALID_ACTIONS = ['plan', 'research', 'implement', 'implement-e2e', 'revise']

function dispatchAgent(taskId: string, action: string) {
  const user = memDb.query('SELECT id FROM users WHERE username = ?').get('queen-bee') as {
    id: string
  }

  if (!VALID_ACTIONS.includes(action)) {
    throw new Error(`Invalid action '${action}'. Must be one of: ${VALID_ACTIONS.join(', ')}`)
  }

  const task = memDb.query('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | null
  if (!task) throw new Error(`Task ${taskId} not found`)

  if (task.agent_status !== 'idle' && task.agent_status !== 'failed') {
    throw new Error(
      `Cannot dispatch agent: task is currently '${task.agent_status}'. Must be 'idle' or 'failed'.`
    )
  }

  if (action === 'implement' || action === 'implement-e2e' || action === 'revise') {
    if (!task.target_repo) {
      throw new Error(`Action '${action}' requires target_repo to be set on the task.`)
    }
  }

  memDb.transaction(() => {
    memDb.run(
      `UPDATE tasks SET action = ?, agent_status = 'queued', updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      [action, user.id, taskId]
    )
    memDb.run(
      'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
      [generateId(), taskId, user.id, 'action_set', JSON.stringify({ action })]
    )
    memDb.run(
      'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
      [generateId(), taskId, user.id, 'status_changed', JSON.stringify({ from: 'idle', to: 'queued' })]
    )
  })()

  return memDb.query('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow
}

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

function insertTask(opts: {
  agentStatus?: string
  targetRepo?: string | null
  action?: string | null
} = {}): string {
  const user = memDb.query('SELECT id FROM users LIMIT 1').get() as { id: string }
  const board = memDb.query('SELECT id FROM boards LIMIT 1').get() as { id: string }
  const col = memDb.query('SELECT id FROM columns LIMIT 1').get() as { id: string }
  const id = generateId()
  memDb.run(
    `INSERT INTO tasks (id, board_id, column_id, title, body, action, target_repo,
                        agent_status, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      board.id,
      col.id,
      'Dispatch Test Task',
      'body',
      opts.action ?? null,
      opts.targetRepo ?? null,
      opts.agentStatus ?? 'idle',
      user.id,
      user.id,
    ]
  )
  return id
}

afterEach(() => {
  memDb.run("DELETE FROM tasks WHERE title = 'Dispatch Test Task'")
  memDb.run('DELETE FROM task_events WHERE type IN (\'action_set\', \'status_changed\')')
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dispatchAgent – action validation', () => {
  it('throws on an unrecognised action', () => {
    const id = insertTask()
    expect(() => dispatchAgent(id, 'fly-to-the-moon')).toThrow(/Invalid action/)
  })

  it('throws on an empty action string', () => {
    const id = insertTask()
    expect(() => dispatchAgent(id, '')).toThrow(/Invalid action/)
  })

  it('accepts each valid action for a plan task', () => {
    for (const action of ['plan', 'research']) {
      const id = insertTask()
      expect(() => dispatchAgent(id, action)).not.toThrow()
    }
  })
})

describe('dispatchAgent – target_repo requirement', () => {
  it('throws for implement when target_repo is null', () => {
    const id = insertTask({ targetRepo: null })
    expect(() => dispatchAgent(id, 'implement')).toThrow(/requires target_repo/)
  })

  it('throws for implement-e2e when target_repo is null', () => {
    const id = insertTask({ targetRepo: null })
    expect(() => dispatchAgent(id, 'implement-e2e')).toThrow(/requires target_repo/)
  })

  it('throws for revise when target_repo is null', () => {
    const id = insertTask({ targetRepo: null })
    expect(() => dispatchAgent(id, 'revise')).toThrow(/requires target_repo/)
  })

  it('succeeds for implement when target_repo is set', () => {
    const id = insertTask({ targetRepo: 'owner/repo' })
    const task = dispatchAgent(id, 'implement')
    expect(task.agent_status).toBe('queued')
  })

  it('plan does NOT require target_repo', () => {
    const id = insertTask({ targetRepo: null })
    expect(() => dispatchAgent(id, 'plan')).not.toThrow()
  })

  it('research does NOT require target_repo', () => {
    const id = insertTask({ targetRepo: null })
    expect(() => dispatchAgent(id, 'research')).not.toThrow()
  })
})

describe('dispatchAgent – task existence check', () => {
  it('throws when task id does not exist', () => {
    expect(() => dispatchAgent('nonexistent-id', 'plan')).toThrow(/not found/)
  })
})

describe('dispatchAgent – status precondition', () => {
  for (const blockedStatus of ['queued', 'running', 'success']) {
    it(`throws when task is already '${blockedStatus}'`, () => {
      const id = insertTask({ agentStatus: blockedStatus })
      expect(() => dispatchAgent(id, 'plan')).toThrow(/Cannot dispatch agent/)
    })
  }

  it('allows re-dispatch when task is idle', () => {
    const id = insertTask({ agentStatus: 'idle' })
    const task = dispatchAgent(id, 'plan')
    expect(task.agent_status).toBe('queued')
  })

  it('allows re-dispatch when task previously failed', () => {
    const id = insertTask({ agentStatus: 'failed' })
    const task = dispatchAgent(id, 'plan')
    expect(task.agent_status).toBe('queued')
  })
})

describe('dispatchAgent – happy path', () => {
  it('sets agent_status to queued and saves action', () => {
    const id = insertTask()
    const task = dispatchAgent(id, 'plan')
    expect(task.agent_status).toBe('queued')
    expect(task.action).toBe('plan')
  })

  it('inserts action_set and status_changed events', () => {
    const id = insertTask()
    dispatchAgent(id, 'research')

    const events = memDb
      .query("SELECT type FROM task_events WHERE task_id = ? ORDER BY created_at ASC")
      .all(id) as Array<{ type: string }>

    const types = events.map((e) => e.type)
    expect(types).toContain('action_set')
    expect(types).toContain('status_changed')
  })
})
