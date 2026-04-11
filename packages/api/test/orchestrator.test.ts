/**
 * orchestrator.test.ts
 *
 * Tests for the Orchestrator class:
 *  - dispatch flow: queued → running → success / failure
 *  - concurrency limit is respected
 *  - retry scheduling on failure
 *
 * Strategy: wire up a real in-memory SQLite database for the `db` singleton and
 * replace the `runAgent` function with a controllable mock so no real process is
 * spawned.  The `pubsub` module is replaced with a no-op stub so GraphQL
 * subscriptions don't interfere.
 */

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { generateId } from '../src/db/ulid'

// ---------------------------------------------------------------------------
// In-memory database shared across module mocks
// ---------------------------------------------------------------------------

const memDb = new Database(':memory:')
memDb.exec('PRAGMA journal_mode = WAL')
memDb.exec('PRAGMA foreign_keys = ON')
createTables(memDb)
seed(memDb)

// ---------------------------------------------------------------------------
// Module mocks – must be set up before importing the orchestrator
// ---------------------------------------------------------------------------

// Mock the db singleton so the orchestrator uses our in-memory database
mock.module('../src/db', () => ({
  db: memDb,
  generateId,
}))

// Mock pubsub to a no-op so publish calls don't throw
mock.module('../src/pubsub', () => ({
  publishAgentLog: () => {},
  publishCommentAdded: () => {},
  publishTaskEvent: () => {},
  publishTaskUpdated: () => {},
  pubsub: { publish: () => {} },
}))

// We will control runAgent per-test via this mutable reference
let mockRunAgentImpl: (...args: unknown[]) => Promise<unknown> = async () => ({
  output: 'ok',
  success: true,
  taskId: '',
})

mock.module('../src/agent/runner', () => ({
  runAgent: (...args: unknown[]) => mockRunAgentImpl(...args),
}))

// ---------------------------------------------------------------------------
// Now import the orchestrator (after mocks are registered)
// ---------------------------------------------------------------------------

const { Orchestrator } = await import('../src/orchestrator/orchestrator')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the minimal Config object the orchestrator needs. */
function makeConfig(
  overrides: { maxAgents?: number; maxRetryBackoffMs?: number } = {},
) {
  return {
    agent: {
      max_concurrent_agents: overrides.maxAgents ?? 5,
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
    workspace: { root: '/tmp/hiveboard-test-workspaces', ttl_ms: 0 },
  }
}

function makeGitHubStub() {
  return {
    fetchReviewComments: async () => [],
    getAccessToken: async () => 'fake-token',
    getIdentity: async () => ({ email: 'test@test.com', name: 'test[bot]' }),
  }
}

/** Build a WorkspaceManager stub that immediately resolves. */
function makeWorkspaceStub() {
  return {
    createForTask: async () => ({ created: true, path: '/tmp/fake-workspace' }),
    sweepExpired: async () => {},
    ttlMs: 0,
  }
}

type TaskRow = {
  id: string
  board_id: string
  column_id: string
  title: string
  body: string
  action: string | null
  agent_instruction: string | null
  target_repo: string | null
  target_branch: string | null
  agent_status: string
  retry_count: number
  created_at: string
  updated_at: string
}

/** Insert a queued task into the in-memory DB and return its id. */
function insertQueuedTask(
  opts: {
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
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    [
      id,
      board.id,
      col.id,
      'Test Task',
      'body',
      opts.action ?? 'plan',
      opts.targetRepo ?? null,
      opts.retryCount ?? 0,
      user.id,
      user.id,
    ],
  )
  return id
}

/** Read a task row from the in-memory DB. */
function getTask(id: string): TaskRow | null {
  return memDb
    .query('SELECT * FROM tasks WHERE id = ?')
    .get(id) as TaskRow | null
}

/** Wait for all currently running async operations to flush. */
async function flushMicrotasks(ms = 50) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Orchestrator – dispatch flow', () => {
  let orchestrator: InstanceType<typeof Orchestrator>

  beforeEach(() => {
    // Default: agent succeeds immediately
    mockRunAgentImpl = async (opts: unknown) => {
      const { task } = opts as { task: { id: string } }
      return { output: 'agent output', success: true, taskId: task.id }
    }
    orchestrator = new Orchestrator(
      makeConfig() as never,
      makeGitHubStub() as never,
      makeWorkspaceStub() as never,
      'prompt template',
    )
  })

  afterEach(async () => {
    await orchestrator.shutdown()
    // Clean up tasks created during the test
    memDb.run("DELETE FROM tasks WHERE title = 'Test Task'")
    memDb.run('DELETE FROM agent_runs')
    memDb.run("DELETE FROM task_events WHERE type NOT IN ('created')")
  })

  it('transitions task from queued → running → success', async () => {
    const taskId = insertQueuedTask({ action: 'plan' })

    // Run a single poll cycle
    await orchestrator.poll()
    // Wait for the async agent execution to complete
    await flushMicrotasks(100)

    const task = getTask(taskId)
    expect(task).not.toBeNull()
    expect(task?.agent_status).toBe('success')

    // agent_runs row should exist and be successful
    const run = memDb
      .query('SELECT * FROM agent_runs WHERE task_id = ?')
      .get(taskId) as { status: string } | null
    expect(run).not.toBeNull()
    expect(run?.status).toBe('success')
  })

  it('transitions task from queued → running → failed when agent errors', async () => {
    mockRunAgentImpl = async (opts: unknown) => {
      const { task } = opts as { task: { id: string } }
      return {
        error: 'something broke',
        output: '',
        success: false,
        taskId: task.id,
      }
    }

    const taskId = insertQueuedTask({ action: 'plan' })

    await orchestrator.poll()
    await flushMicrotasks(100)

    const task = getTask(taskId)
    expect(task?.agent_status).toBe('failed')

    const run = memDb
      .query('SELECT * FROM agent_runs WHERE task_id = ?')
      .get(taskId) as { status: string; error: string } | null
    expect(run?.status).toBe('failed')
    expect(run?.error).toContain('something broke')
  })

  it('records an agent_started event on dispatch', async () => {
    const taskId = insertQueuedTask({ action: 'plan' })
    await orchestrator.poll()
    await flushMicrotasks(100)

    const event = memDb
      .query(
        "SELECT * FROM task_events WHERE task_id = ? AND type = 'agent_started'",
      )
      .get(taskId) as { type: string } | null
    expect(event).not.toBeNull()
  })

  it('records an agent_succeeded event on success', async () => {
    const taskId = insertQueuedTask({ action: 'plan' })
    await orchestrator.poll()
    await flushMicrotasks(100)

    const event = memDb
      .query(
        "SELECT * FROM task_events WHERE task_id = ? AND type = 'agent_succeeded'",
      )
      .get(taskId) as { type: string } | null
    expect(event).not.toBeNull()
  })

  it('marks agent_runs row as failed when dispatch fails after insert', async () => {
    // Use a workspace stub that throws to simulate dispatch failure
    const failingWorkspaceStub = {
      createForTask: async () => {
        throw new Error('workspace creation failed')
      },
      sweepExpired: async () => {},
      ttlMs: 0,
    }
    const failOrchestrator = new Orchestrator(
      makeConfig() as never,
      makeGitHubStub() as never,
      failingWorkspaceStub as never,
      'prompt template',
    )

    const taskId = insertQueuedTask({ action: 'plan' })
    await failOrchestrator.poll()
    await flushMicrotasks(100)

    // Task should be reset to queued
    const task = getTask(taskId)
    expect(task?.agent_status).toBe('queued')

    // agent_runs row should exist and be marked as failed (not orphaned)
    const run = memDb
      .query('SELECT * FROM agent_runs WHERE task_id = ?')
      .get(taskId) as {
      status: string
      error: string
      finished_at: string | null
    } | null
    expect(run).not.toBeNull()
    expect(run?.status).toBe('failed')
    expect(run?.error).toContain('workspace creation failed')
    expect(run?.finished_at).not.toBeNull()

    await failOrchestrator.shutdown()
  })

  it('records an agent_failed event on failure', async () => {
    mockRunAgentImpl = async (opts: unknown) => {
      const { task } = opts as { task: { id: string } }
      return { error: 'boom', output: '', success: false, taskId: task.id }
    }

    const taskId = insertQueuedTask({ action: 'plan' })
    await orchestrator.poll()
    await flushMicrotasks(100)

    const event = memDb
      .query(
        "SELECT * FROM task_events WHERE task_id = ? AND type = 'agent_failed'",
      )
      .get(taskId) as { type: string } | null
    expect(event).not.toBeNull()
  })
})

describe('Orchestrator – concurrency limit', () => {
  let orchestrator: InstanceType<typeof Orchestrator>

  // Latch to hold agents "in flight"
  let releaseLatch!: () => void

  beforeEach(() => {
    releaseLatch = () => {}
    orchestrator = new Orchestrator(
      makeConfig({ maxAgents: 2 }) as never,
      makeGitHubStub() as never,
      makeWorkspaceStub() as never,
      'prompt template',
    )
  })

  afterEach(async () => {
    releaseLatch()
    await orchestrator.shutdown()
    memDb.run("DELETE FROM tasks WHERE title = 'Test Task'")
    memDb.run('DELETE FROM agent_runs')
    memDb.run("DELETE FROM task_events WHERE type NOT IN ('created')")
  })

  it('does not exceed max_concurrent_agents', async () => {
    // Agent blocks until latch is released
    let activeAgents = 0
    let peakAgents = 0

    const latch = new Promise<void>((resolve) => {
      releaseLatch = resolve
    })

    mockRunAgentImpl = async (opts: unknown) => {
      activeAgents++
      peakAgents = Math.max(peakAgents, activeAgents)
      await latch
      activeAgents--
      const { task } = opts as { task: { id: string } }
      return { output: 'ok', success: true, taskId: task.id }
    }

    // Insert 4 queued tasks but max_concurrent_agents = 2
    insertQueuedTask({ action: 'plan' })
    insertQueuedTask({ action: 'plan' })
    insertQueuedTask({ action: 'plan' })
    insertQueuedTask({ action: 'plan' })

    await orchestrator.poll()
    await flushMicrotasks(50)

    // After one poll cycle only up to 2 agents should be active
    expect(activeAgents).toBeLessThanOrEqual(2)
    expect(peakAgents).toBeLessThanOrEqual(2)

    // Release the latch so agents finish and don't block shutdown
    releaseLatch()
    await flushMicrotasks(100)
  })

  it('picks up remaining queued tasks in subsequent poll cycles', async () => {
    // First pass: block 2 agents
    let pass1Latch: (() => void) | undefined
    const firstWave = new Promise<void>((r) => {
      pass1Latch = r
    })
    let firstWaveCount = 0

    mockRunAgentImpl = async (opts: unknown) => {
      firstWaveCount++
      if (firstWaveCount <= 2) await firstWave
      const { task } = opts as { task: { id: string } }
      return { output: 'ok', success: true, taskId: task.id }
    }

    const _t1 = insertQueuedTask({ action: 'plan' })
    const _t2 = insertQueuedTask({ action: 'plan' })
    const t3 = insertQueuedTask({ action: 'plan' })

    // First poll picks up t1 + t2 (limit=2), t3 stays queued
    await orchestrator.poll()
    await flushMicrotasks(50)

    expect(getTask(t3)?.agent_status).toBe('queued')

    // Release first wave, wait for completion
    pass1Latch?.()
    releaseLatch = pass1Latch as () => void
    await flushMicrotasks(100)

    // Second poll can now pick up t3
    await orchestrator.poll()
    await flushMicrotasks(100)

    expect(getTask(t3)?.agent_status).toBe('success')
  })
})

describe('Orchestrator – retry scheduling', () => {
  let orchestrator: InstanceType<typeof Orchestrator>

  beforeEach(() => {
    mockRunAgentImpl = async (opts: unknown) => {
      const { task } = opts as { task: { id: string } }
      return {
        error: 'transient error',
        output: '',
        success: false,
        taskId: task.id,
      }
    }
    orchestrator = new Orchestrator(
      makeConfig({ maxRetryBackoffMs: 50 }) as never,
      makeGitHubStub() as never,
      makeWorkspaceStub() as never,
      'prompt template',
    )
  })

  afterEach(async () => {
    await orchestrator.shutdown()
    memDb.run("DELETE FROM tasks WHERE title = 'Test Task'")
    memDb.run('DELETE FROM agent_runs')
    memDb.run("DELETE FROM task_events WHERE type NOT IN ('created')")
  })

  it('schedules a retry and increments retry_count after failure', async () => {
    // max_retry_backoff_ms=50 means baseDelay * 2^0 = 10_000, capped to 50ms.
    // The timer fires within ~50ms so by the time we wait 200ms the task is
    // already re-queued – that is the correct end state we assert.
    const taskId = insertQueuedTask({ action: 'plan', retryCount: 0 })

    await orchestrator.poll()
    // Wait long enough for the agent to complete AND for the retry timer to fire
    await flushMicrotasks(250)

    const task = getTask(taskId)
    // After the retry timer fires the task is re-queued with incremented count
    expect(task?.agent_status).toBe('queued')
    expect(task?.retry_count).toBe(1)
  })

  it('inserts a retry_scheduled event', async () => {
    const taskId = insertQueuedTask({ action: 'plan', retryCount: 0 })

    await orchestrator.poll()
    await flushMicrotasks(200)

    const event = memDb
      .query(
        "SELECT * FROM task_events WHERE task_id = ? AND type = 'retry_scheduled'",
      )
      .get(taskId) as { data: string } | null
    expect(event).not.toBeNull()
    const data = JSON.parse(event?.data)
    expect(data.attempt).toBe(1)
  })

  it('cancelling a task clears the pending retry timer', async () => {
    // Use a much longer backoff so the timer does NOT fire before we cancel.
    // We need a separate orchestrator instance with a longer backoff for this test.
    const longBackoffOrchestrator = new Orchestrator(
      makeConfig({ maxRetryBackoffMs: 60_000 }) as never,
      makeGitHubStub() as never,
      makeWorkspaceStub() as never,
      'prompt template',
    )

    const taskId = insertQueuedTask({ action: 'plan', retryCount: 0 })

    await longBackoffOrchestrator.poll()
    await flushMicrotasks(100)

    // Task has failed, retry timer is pending (backoff = min(10_000, 60_000) = 10s)
    expect(longBackoffOrchestrator.getStatus().pendingRetries).toBe(1)

    // Manually set task to idle so cancelTask can update it
    memDb.run("UPDATE tasks SET agent_status = 'idle' WHERE id = ?", [taskId])
    await longBackoffOrchestrator.cancelTask(taskId)

    expect(longBackoffOrchestrator.getStatus().pendingRetries).toBe(0)

    await longBackoffOrchestrator.shutdown()
  })
})
