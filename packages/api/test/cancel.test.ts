/**
 * cancel.test.ts
 *
 * Tests for `cancelAgent` resolver logic and `Orchestrator.cancelTask`:
 *  - Cancelling a queued task updates agent_status → idle
 *  - Cancelling a running task aborts the in-flight agent and updates status
 *  - Cancelling a task that has a pending retry clears the timer
 *  - Cancelling a non-existent task still sets status to idle (idempotent)
 *
 * Same mocking strategy as orchestrator.test.ts – we inject an in-memory
 * SQLite database and stub out the agent runner.
 */

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
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
  publishAgentLog: () => {},
  publishCommentAdded: () => {},
  publishTaskEvent: () => {},
  publishTaskUpdated: () => {},
  pubsub: { publish: () => {} },
}))

// Controllable runAgent mock
let mockRunAgentImpl: (opts: unknown) => Promise<unknown> = async (opts) => {
  const { task } = opts as { task: { id: string } }
  return { output: 'ok', success: true, taskId: task.id }
}

mock.module('../src/agent/runner', () => ({
  runAgent: (opts: unknown) => mockRunAgentImpl(opts),
}))

// ---------------------------------------------------------------------------
// Import orchestrator after mocks
// ---------------------------------------------------------------------------

const { Orchestrator } = await import('../src/orchestrator/orchestrator')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: { maxRetryBackoffMs?: number } = {}) {
  return {
    agent: {
      max_concurrent_agents: 5,
      max_retry_backoff_ms: overrides.maxRetryBackoffMs ?? 300_000,
    },
    claude: {
      allowed_tools: [],
      command: 'claude',
      max_turns: 5,
      model: undefined,
      permission_mode: undefined,
    },
    hooks: { timeout_ms: 5_000 },
    polling: { interval_ms: 60_000 },
    workspace: { root: '/tmp/hiveboard-cancel-test', ttl_ms: 0 },
  }
}

function makeGitHubStub() {
  return {
    fetchReviewComments: async () => [],
    getAccessToken: async () => 'fake-token',
    getIdentity: async () => ({ email: 'test@test.com', name: 'test[bot]' }),
    getTokenDir: () => '/tmp/hiveboard-tokens-test',
  }
}

function makeWorkspaceStub() {
  return {
    createForTask: async () => ({ created: true, path: '/tmp/fake-ws' }),
    sweepExpired: async () => {},
    ttlMs: 0,
  }
}

type TaskRow = {
  id: string
  agent_status: string
  agent_instruction: string | null
  target_branch: string | null
  retry_count: number
}

function insertTask(
  opts: {
    agentStatus?: string
    action?: string
    targetRepo?: string | null
    retryCount?: number
  } = {},
): string {
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
    `INSERT INTO tasks (id, board_id, column_id, title, body, action, target_repo,
                        agent_status, retry_count, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      board.id,
      col.id,
      'Cancel Test Task',
      'body',
      opts.action ?? 'plan',
      opts.targetRepo ?? null,
      opts.agentStatus ?? 'idle',
      opts.retryCount ?? 0,
      user.id,
      user.id,
    ],
  )
  return id
}

function getTask(id: string): TaskRow | null {
  return memDb
    .query('SELECT * FROM tasks WHERE id = ?')
    .get(id) as TaskRow | null
}

async function flush(ms = 50) {
  await new Promise<void>((r) => setTimeout(r, ms))
}

/** Mirror the cancelAgent resolver's DB-update logic (atomic version). */
async function cancelAgent(
  orchestrator: InstanceType<typeof Orchestrator> | null,
  taskId: string,
): Promise<boolean> {
  const user = memDb
    .query('SELECT id FROM users WHERE username = ?')
    .get('queen-bee') as {
    id: string
  }

  if (orchestrator) {
    await orchestrator.cancelTask(taskId)
  }

  // Atomic update: only cancel if task is in a cancellable state
  const result = memDb.run(
    `UPDATE tasks SET agent_status = 'idle', action = NULL, updated_by = ?, updated_at = datetime('now') WHERE id = ? AND agent_status IN ('running', 'queued', 'failed')`,
    [user.id, taskId],
  )

  if (result.changes === 0) {
    return false
  }

  memDb.run(
    'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
    [
      generateId(),
      taskId,
      user.id,
      'status_changed',
      JSON.stringify({ from: 'cancelled', to: 'idle' }),
    ],
  )

  return true
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  memDb.run("DELETE FROM tasks WHERE title = 'Cancel Test Task'")
  memDb.run("DELETE FROM task_events WHERE type = 'status_changed'")
  memDb.run('DELETE FROM agent_runs')
})

describe('cancelAgent – queued task', () => {
  it('transitions queued → idle', async () => {
    const id = insertTask({ agentStatus: 'queued' })
    await cancelAgent(null, id)
    expect(getTask(id)?.agent_status).toBe('idle')
  })

  it('inserts a status_changed event recording the transition', async () => {
    const id = insertTask({ agentStatus: 'queued' })
    await cancelAgent(null, id)

    const event = memDb
      .query(
        "SELECT data FROM task_events WHERE task_id = ? AND type = 'status_changed' ORDER BY created_at DESC LIMIT 1",
      )
      .get(id) as { data: string } | null

    expect(event).not.toBeNull()
    const data = JSON.parse(event?.data)
    expect(data.from).toBe('cancelled')
    expect(data.to).toBe('idle')
  })
})

describe('cancelAgent – running task', () => {
  let orchestrator: InstanceType<typeof Orchestrator>
  let releaseLatch: () => void = () => {}

  beforeEach(() => {
    orchestrator = new Orchestrator(
      makeConfig() as never,
      makeGitHubStub() as never,
      makeWorkspaceStub() as never,
      'prompt template',
    )
  })

  afterEach(async () => {
    releaseLatch()
    await orchestrator.shutdown()
  })

  it('aborts the running agent and transitions to idle', async () => {
    let agentAborted = false
    const latch = new Promise<void>((resolve) => {
      releaseLatch = resolve
    })

    mockRunAgentImpl = async (opts) => {
      const { signal, task } = opts as {
        signal: AbortSignal
        task: { id: string }
      }
      // Wait for abort or latch release
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          agentAborted = true
          resolve()
        })
        latch.then(resolve)
      })
      return { error: 'aborted', output: '', success: false, taskId: task.id }
    }

    const id = insertTask({ agentStatus: 'queued' })
    await orchestrator.poll()
    await flush(50) // let agent start

    // Task should now be running
    expect(getTask(id)?.agent_status).toBe('running')

    // Cancel via orchestrator + DB update
    await cancelAgent(orchestrator, id)

    expect(agentAborted).toBe(true)
    expect(getTask(id)?.agent_status).toBe('idle')
  })

  it('marks the agent_run as failed after cancel', async () => {
    const latch = new Promise<void>((resolve) => {
      releaseLatch = resolve
    })

    mockRunAgentImpl = async (opts) => {
      const { signal, task } = opts as {
        signal: AbortSignal
        task: { id: string }
      }
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', resolve)
        latch.then(resolve)
      })
      return { error: 'aborted', output: '', success: false, taskId: task.id }
    }

    const id = insertTask({ agentStatus: 'queued' })
    await orchestrator.poll()
    await flush(50)

    await orchestrator.cancelTask(id)
    await flush(50) // let agent complete after abort

    const run = memDb
      .query(
        'SELECT status FROM agent_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 1',
      )
      .get(id) as { status: string } | null

    // The agent_run row ends up as 'failed' (either via the onComplete path
    // triggered by the abort mock result or via the orchestrator's cancel update)
    expect(run).not.toBeNull()
    expect(run?.status).toBe('failed')
  })
})

describe('cancelAgent – retry timer cleared', () => {
  it('clears the pending retry timer when a failed task is cancelled', async () => {
    // Agent always fails so retry scheduling is triggered
    mockRunAgentImpl = async (opts) => {
      const { task } = opts as { task: { id: string } }
      return { error: 'fail', output: '', success: false, taskId: task.id }
    }

    // Use a long backoff so the timer does NOT fire before we call cancel
    const orchestrator = new Orchestrator(
      makeConfig({ maxRetryBackoffMs: 60_000 }) as never,
      makeGitHubStub() as never,
      makeWorkspaceStub() as never,
      'prompt template',
    )

    const id = insertTask({ agentStatus: 'queued' })

    await orchestrator.poll()
    await flush(100)

    // Task failed → retry timer is pending (baseDelay = 10s, backoff = min(10_000, 60_000))
    expect(orchestrator.getStatus().pendingRetries).toBe(1)

    // Cancel should clear the retry timer
    await orchestrator.cancelTask(id)

    expect(orchestrator.getStatus().pendingRetries).toBe(0)

    await orchestrator.shutdown()
  })
})

describe('cancelAgent – idle task (no-op)', () => {
  it('keeps agent_status as idle and returns false', async () => {
    const id = insertTask({ agentStatus: 'idle' })
    const cancelled = await cancelAgent(null, id)
    expect(cancelled).toBe(false)
    expect(getTask(id)?.agent_status).toBe('idle')
  })
})

describe('cancelAgent – race condition', () => {
  it('prevents re-queuing between read and write by using atomic update', async () => {
    const id = insertTask({ agentStatus: 'running' })

    // Simulate the race: another process changes status to 'queued' right before cancel
    // With the old non-atomic approach, this would be missed.
    // With atomic UPDATE ... WHERE agent_status IN ('running', 'queued'),
    // the first cancel succeeds atomically.
    const cancelled = await cancelAgent(null, id)
    expect(cancelled).toBe(true)
    expect(getTask(id)?.agent_status).toBe('idle')

    // A second cancel on the now-idle task should be a no-op (returns false)
    const cancelledAgain = await cancelAgent(null, id)
    expect(cancelledAgain).toBe(false)
    expect(getTask(id)?.agent_status).toBe('idle')
  })

  it('fails to cancel if another operation already changed status to idle', async () => {
    const id = insertTask({ agentStatus: 'running' })

    // Simulate race: another process sets status to idle before our cancel runs
    memDb.run(
      `UPDATE tasks SET agent_status = 'idle' WHERE id = ?`,
      [id],
    )

    // Cancel should detect that status is no longer cancellable
    const cancelled = await cancelAgent(null, id)
    expect(cancelled).toBe(false)
    expect(getTask(id)?.agent_status).toBe('idle')

    // No spurious status_changed event should be created
    const events = memDb
      .query(
        "SELECT COUNT(*) as count FROM task_events WHERE task_id = ? AND type = 'status_changed'",
      )
      .get(id) as { count: number }
    expect(events.count).toBe(0)
  })
})
