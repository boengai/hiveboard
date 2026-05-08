import { Database } from 'bun:sqlite'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildClaudeArgsForTest as realBuildClaudeArgsForTest } from '../src/agent/runner'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { generateId } from '../src/db/ulid'
import {
  makeConfig,
  makeGitHubStub,
  makeWorkspaceStub,
} from './helpers/fixtures'

// ---------------------------------------------------------------------------
// In-memory DB + filesystem setup
// ---------------------------------------------------------------------------

const memDb = new Database(':memory:')
memDb.exec('PRAGMA journal_mode = WAL')
memDb.exec('PRAGMA foreign_keys = ON')
createTables(memDb)
seed(memDb)

// Unique tmp dir for this test suite's agent-state so it doesn't collide
// with other tests that share the default './tmp/agent-state' root.
const stateRoot = mkdtempSync(join(tmpdir(), 'hb-orch-timebox-'))

// ---------------------------------------------------------------------------
// Module mocks – must precede orchestrator import
// ---------------------------------------------------------------------------

mock.module('../src/db', () => ({
  db: memDb,
  generateId,
}))

mock.module('../src/pubsub', () => ({
  publishAgentLog: () => {},
  publishCommentAdded: () => {},
  publishMessageAdded: () => {},
  publishScratchpadUpdated: () => {},
  publishTaskEvent: () => {},
  publishTaskProgress: () => {},
  publishTaskUpdated: () => {},
  publishVerificationRun: () => {},
  publishWorkspaceSnapshot: () => {},
  pubsub: {
    publish: () => {},
  },
}))

mock.module('../src/agent/runner', () => ({
  buildClaudeArgsForTest: realBuildClaudeArgsForTest,
  runAgent: async () => ({ output: 'ok', success: true, taskId: '' }),
}))

const { Orchestrator } = await import('../src/orchestrator/orchestrator')
const { selectSchedulableTasks } = await import(
  '../src/orchestrator/scheduler'
)
const { resolvers } = await import('../src/schema/resolvers')

// ---------------------------------------------------------------------------
// Unit tests (original)
// ---------------------------------------------------------------------------

describe('time-box timer semantics (unit)', () => {
  it('setTimeout fires at or after the configured budget', async () => {
    let aborted = false
    const ac = new AbortController()
    const start = Date.now()
    const t = setTimeout(() => {
      aborted = true
      ac.abort('TIMEOUT')
    }, 250)

    await new Promise((r) => setTimeout(r, 400))
    clearTimeout(t)
    expect(aborted).toBe(true)
    expect(ac.signal.aborted).toBe(true)
    expect(Date.now() - start).toBeGreaterThanOrEqual(250)
  })

  it('clearTimeout before expiry prevents abort (normal exit beats timer)', async () => {
    let aborted = false
    const ac = new AbortController()
    const t = setTimeout(() => {
      aborted = true
      ac.abort('TIMEOUT')
    }, 200)

    await new Promise((r) => setTimeout(r, 50))
    clearTimeout(t)
    await new Promise((r) => setTimeout(r, 200))
    expect(aborted).toBe(false)
    expect(ac.signal.aborted).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Integration test: full onComplete TIMEOUT path
// ---------------------------------------------------------------------------

describe('Orchestrator – TIMEOUT post-exit path', () => {
  let orchestrator: InstanceType<typeof Orchestrator>

  beforeEach(() => {
    orchestrator = new Orchestrator(
      makeConfig(stateRoot) as never,
      makeGitHubStub() as never,
      makeWorkspaceStub() as never,
      'prompt template',
    )
  })

  afterEach(async () => {
    // Clear the running map before shutdown so the drain loop doesn't block.
    // _onCompleteForTest does not run the `finally` block that calls
    // running.delete(), so we must clean up manually here.
    ;(orchestrator as any).running.clear()
    await orchestrator.shutdown()
    memDb.run('DELETE FROM agent_runs')
    memDb.run('DELETE FROM task_events')
    memDb.run('DELETE FROM tasks')
  })

  afterAll(() => {
    try {
      rmSync(stateRoot, { force: true, recursive: true })
    } catch {
      // ignore
    }
  })

  it('TIMEOUT abortReason → task BLOCKED+TIMEOUT, run FAILED+time-box expired, time_box_expired event', async () => {
    // Seed a task with time_box_ms=500 in agent_status='running'
    const user = memDb.query('SELECT id FROM users LIMIT 1').get() as {
      id: string
    }
    const board = memDb.query('SELECT id FROM boards LIMIT 1').get() as {
      id: string
    }
    const col = memDb.query('SELECT id FROM columns LIMIT 1').get() as {
      id: string
    }
    const taskId = generateId()
    memDb.run(
      `INSERT INTO tasks (id, board_id, column_id, title, body, action, target_repo,
                          agent_status, retry_count, time_box_ms, created_by, updated_by)
       VALUES (?, ?, ?, 'slow task', '', 'implement', NULL, 'running', 0, 500, ?, ?)`,
      [taskId, board.id, col.id, user.id, user.id],
    )
    const runId = generateId()
    memDb.run(
      `INSERT INTO agent_runs (id, task_id, action, status, started_at)
       VALUES (?, ?, 'implement', 'running', datetime('now'))`,
      [runId, taskId],
    )

    // Seed a RunState with abortReason='TIMEOUT' into the private running Map
    const fakeRunState = {
      abortController: new AbortController(),
      abortReason: 'TIMEOUT' as const,
      done: Promise.resolve(),
      resolveDone: () => {},
      retryAttempt: 0,
      startedAt: new Date(),
      taskId,
      workspacePath: '/tmp/fake',
    }
    ;(orchestrator as any).running.set(taskId, fakeRunState)

    const taskRow = memDb
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(taskId) as Parameters<typeof orchestrator._onCompleteForTest>[0]

    await orchestrator._onCompleteForTest(taskRow, runId, {
      error: 'aborted',
      output: '',
      success: false,
      taskId,
    })

    const row = memDb
      .query('SELECT agent_status, block_reason FROM tasks WHERE id = ?')
      .get(taskId) as { agent_status: string; block_reason: string }
    expect(row.agent_status).toBe('blocked')
    expect(row.block_reason).toBe('TIMEOUT')

    const run = memDb
      .query('SELECT status, error FROM agent_runs WHERE id = ?')
      .get(runId) as { status: string; error: string }
    expect(run.status).toBe('failed')
    expect(run.error).toBe('time-box expired')

    const ev = memDb
      .query(
        "SELECT type, data FROM task_events WHERE task_id = ? AND type = 'time_box_expired'",
      )
      .get(taskId) as { type: string; data: string } | null
    expect(ev?.type).toBe('time_box_expired')
    const parsed = JSON.parse(ev?.data)
    expect(parsed.limit_ms).toBe(500)
  })

  it('expire → extend → resume: task re-queues with new budget and clears block_reason', async () => {
    // Seed: running task with time_box_ms=500
    const user = memDb.query('SELECT id FROM users LIMIT 1').get() as {
      id: string
    }
    const board = memDb.query('SELECT id FROM boards LIMIT 1').get() as {
      id: string
    }
    const col = memDb.query('SELECT id FROM columns LIMIT 1').get() as {
      id: string
    }
    const taskId = generateId()
    memDb.run(
      `INSERT INTO tasks (id, board_id, column_id, title, body, action, target_repo,
                          agent_status, retry_count, time_box_ms, created_by, updated_by)
       VALUES (?, ?, ?, 'slow task', '', 'implement', NULL, 'running', 0, 500, ?, ?)`,
      [taskId, board.id, col.id, user.id, user.id],
    )
    const runId = generateId()
    memDb.run(
      `INSERT INTO agent_runs (id, task_id, action, status, started_at)
       VALUES (?, ?, 'implement', 'running', datetime('now'))`,
      [runId, taskId],
    )

    // Prime a fake RunState with abortReason='TIMEOUT'
    ;(orchestrator as any).running.set(taskId, {
      abortController: new AbortController(),
      abortReason: 'TIMEOUT',
      done: Promise.resolve(),
      resolveDone: () => {},
      retryAttempt: 0,
      startedAt: new Date(),
      taskId,
      workspacePath: '/tmp/fake',
    })

    const taskRow = memDb
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(taskId) as Parameters<typeof orchestrator._onCompleteForTest>[0]

    // Drive the TIMEOUT path
    await orchestrator._onCompleteForTest(taskRow, runId, {
      error: 'aborted',
      output: '',
      success: false,
      taskId,
    })

    // Sanity: task is BLOCKED+TIMEOUT now
    const blocked = memDb
      .query('SELECT agent_status, block_reason FROM tasks WHERE id = ?')
      .get(taskId) as { agent_status: string; block_reason: string }
    expect(blocked.agent_status).toBe('blocked')
    expect(blocked.block_reason).toBe('TIMEOUT')

    // Call extendTimeBox via the resolver (uses memDb via the mocked ../src/db module)
    const authCtx = {
      user: {
        displayName: 'Queen Bee',
        githubId: null,
        githubUsername: null,
        id: user.id,
        role: 'super-admin',
        username: 'queen-bee',
      },
    }
    const extended = await (resolvers.Mutation as any).extendTimeBox(
      null,
      { additionalMs: 5000, taskId },
      authCtx,
    )
    expect(extended.agentStatus).toBe('QUEUED')
    expect(extended.timeBoxMs).toBe(5500)
    expect(extended.blockReason).toBeNull()

    const row = memDb
      .query('SELECT time_box_started_at, block_reason FROM tasks WHERE id = ?')
      .get(taskId) as {
      time_box_started_at: string | null
      block_reason: string | null
    }
    expect(row.time_box_started_at).toBeNull()
    expect(row.block_reason).toBeNull()

    // Collapse the +5 s grace window so the task is immediately schedulable
    memDb.run(
      `UPDATE tasks SET queue_after = datetime('now', '-1 second') WHERE id = ?`,
      [taskId],
    )

    // Task is eligible for the scheduler again
    const picked = selectSchedulableTasks(memDb, {
      legacyMode: false,
      limit: 10,
    })
    expect(picked.map((t) => t.id)).toContain(taskId)
  })
})
