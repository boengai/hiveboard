/**
 * orchestrator-dispatch.test.ts
 *
 * Tests for Task 8 of the bidirectional-channel plan:
 * Orchestrator.dispatchHumanMessage handles per-kind side effects for
 * human-authored messages:
 *  - 'redirect': aborts the running agent + requeues with queue_after = +5s
 *  - 'hint':     appends to $HIVEBOARD_INBOX + marks undelivered hints delivered
 *  - 'answer':   no-op (handled by answerQuestion mutation in Task 9)
 *
 * Strategy mirrors orchestrator-blocked.test.ts: in-memory sqlite, pubsub/runner
 * stubs, Orchestrator constructed against a real tmp state_root. The RunState
 * is seeded directly into the private `running` map via a focused type coercion
 * so we can exercise the abort path without spinning up an agent process.
 */

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
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildClaudeArgsForTest as realBuildClaudeArgsForTest } from '../src/agent/runner'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { generateId } from '../src/db/ulid'

// ---------------------------------------------------------------------------
// In-memory DB + filesystem setup
// ---------------------------------------------------------------------------

const memDb = new Database(':memory:')
memDb.exec('PRAGMA journal_mode = WAL')
memDb.exec('PRAGMA foreign_keys = ON')
createTables(memDb)
seed(memDb)

const stateRoot = mkdtempSync(join(tmpdir(), 'hb-orch-dispatch-'))

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
  pubsub: { publish: () => {} },
}))

mock.module('../src/agent/runner', () => ({
  buildClaudeArgsForTest: realBuildClaudeArgsForTest,
  runAgent: async () => ({ output: 'ok', success: true, taskId: '' }),
}))

const { Orchestrator } = await import('../src/orchestrator/orchestrator')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig() {
  return {
    agent: {
      max_concurrent_agents: 5,
      max_retry_backoff_ms: 300_000,
      state_root: stateRoot,
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
    scheduler: { legacy_mode: false },
    verify: { commands: [], enabled: false, max_auto_revises: 1 },
    workspace: { root: '/tmp/hiveboard-dispatch-ws', ttl_ms: 0 },
  }
}

function makeGitHubStub() {
  return {
    fetchReviewComments: async () => [],
    findPrByHead: async () => null,
    getAccessToken: async () => 'fake-token',
    getIdentity: async () => ({ email: 'test@test.com', name: 'test[bot]' }),
    getTokenDir: () => '/tmp/hiveboard-tokens-test',
  }
}

function makeWorkspaceStub() {
  return {
    createForTask: async () => ({ created: true, path: '/tmp/fake-workspace' }),
    sweepExpired: async () => {},
    ttlMs: 0,
  }
}

function insertTask(agentStatus: 'running' | 'queued' | 'idle'): string {
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
     VALUES (?, ?, ?, ?, ?, 'plan', NULL, ?, 0, ?, ?)`,
    [
      id,
      board.id,
      col.id,
      'Dispatch Test Task',
      'body',
      agentStatus,
      user.id,
      user.id,
    ],
  )
  return id
}

function insertHintMessage(taskId: string, body: string): string {
  const id = generateId()
  const user = memDb.query('SELECT id FROM users LIMIT 1').get() as {
    id: string
  }
  memDb.run(
    `INSERT INTO task_messages (id, task_id, author_type, kind, body, created_by)
     VALUES (?, ?, 'human', 'hint', ?, ?)`,
    [id, taskId, body, user.id],
  )
  return id
}

/** Seed a fake RunState into orchestrator.running. Returns the AbortController. */
function seedRunState(
  orchestrator: InstanceType<typeof Orchestrator>,
  taskId: string,
): AbortController {
  const abortController = new AbortController()
  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  const runState = {
    abortController,
    done,
    resolveDone,
    retryAttempt: 0,
    startedAt: new Date(),
    taskId,
    workspacePath: '/tmp/fake-workspace',
  }
  // Reach into the private `running` map via a focused coercion.
  const runningMap = (
    orchestrator as unknown as { running: Map<string, typeof runState> }
  ).running
  runningMap.set(taskId, runState)
  return abortController
}

/**
 * Remove all fake RunStates from orchestrator.running and resolve their
 * `done` promises, so orchestrator.shutdown() returns promptly. In a real
 * run, `runAgentAsync` handles this cleanup itself.
 */
function drainRunning(orchestrator: InstanceType<typeof Orchestrator>): void {
  const runningMap = (
    orchestrator as unknown as {
      running: Map<string, { resolveDone: () => void }>
    }
  ).running
  for (const rs of runningMap.values()) {
    rs.resolveDone()
  }
  runningMap.clear()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Orchestrator.dispatchHumanMessage', () => {
  let orchestrator: InstanceType<typeof Orchestrator>

  beforeEach(() => {
    orchestrator = new Orchestrator(
      makeConfig() as never,
      makeGitHubStub() as never,
      makeWorkspaceStub() as never,
      'prompt template',
    )
  })

  afterEach(async () => {
    // Clean up any seeded fake RunStates so shutdown() doesn't hang waiting
    // for them to drain (no real runAgentAsync to remove them).
    drainRunning(orchestrator)
    await orchestrator.shutdown()
    memDb.run("DELETE FROM tasks WHERE title = 'Dispatch Test Task'")
    memDb.run('DELETE FROM task_messages')
    memDb.run('DELETE FROM agent_runs')
    memDb.run("DELETE FROM task_events WHERE type NOT IN ('created')")
  })

  afterAll(() => {
    try {
      rmSync(stateRoot, { force: true, recursive: true })
    } catch {
      // ignore
    }
  })

  it("'redirect' aborts the running agent and requeues with queue_after +5s", async () => {
    const taskId = insertTask('running')
    const abortController = seedRunState(orchestrator, taskId)

    const before = Date.now()
    await orchestrator.dispatchHumanMessage(taskId, 'redirect', 'abort!')

    // Abort was called.
    expect(abortController.signal.aborted).toBe(true)

    // Task was requeued with queue_after ~5 seconds in the future.
    const row = memDb
      .query('SELECT agent_status, queue_after FROM tasks WHERE id = ?')
      .get(taskId) as { agent_status: string; queue_after: string } | null
    expect(row?.agent_status).toBe('queued')
    expect(row?.queue_after).not.toBeNull()

    // queue_after should be between now+3s and now+10s (wide tolerance for CI clock skew).
    // SQLite datetime strings are UTC; append 'Z' so Date parses as UTC.
    const queueAfterMs = new Date(`${row?.queue_after}Z`).getTime()
    expect(queueAfterMs).toBeGreaterThanOrEqual(before + 3_000)
    expect(queueAfterMs).toBeLessThanOrEqual(before + 10_000)
  })

  it("'hint' appends '[hint] <body>' to inbox and marks the hint delivered", async () => {
    const taskId = insertTask('running')
    const msgId = insertHintMessage(taskId, 'fyi')

    await orchestrator.dispatchHumanMessage(taskId, 'hint', 'fyi', msgId)

    // Inbox file exists and contains '[hint] fyi'.
    const inboxFile = join(stateRoot, taskId, 'inbox.md')
    expect(existsSync(inboxFile)).toBe(true)
    const contents = readFileSync(inboxFile, 'utf8')
    expect(contents).toContain('[hint] fyi')

    // The undelivered hint row has delivered_at set.
    const row = memDb
      .query('SELECT delivered_at FROM task_messages WHERE id = ?')
      .get(msgId) as { delivered_at: string | null } | null
    expect(row?.delivered_at).not.toBeNull()
  })

  it("'hint' marks only the specific messageId delivered (race safety)", async () => {
    const taskId = insertTask('running')
    // Two hints inserted back-to-back — simulates the race where two resolvers
    // both append and mark-delivered before the other's UPDATE lands.
    const firstId = insertHintMessage(taskId, 'first')
    const secondId = insertHintMessage(taskId, 'second')

    // Only dispatch the second one.
    await orchestrator.dispatchHumanMessage(taskId, 'hint', 'second', secondId)

    const firstRow = memDb
      .query('SELECT delivered_at FROM task_messages WHERE id = ?')
      .get(firstId) as { delivered_at: string | null }
    const secondRow = memDb
      .query('SELECT delivered_at FROM task_messages WHERE id = ?')
      .get(secondId) as { delivered_at: string | null }

    // First hint is still undelivered (nobody dispatched it yet).
    expect(firstRow.delivered_at).toBeNull()
    // Second hint was marked delivered.
    expect(secondRow.delivered_at).not.toBeNull()
  })

  it("'hint' is a no-op when task is not running (message stays undelivered)", async () => {
    const taskId = insertTask('idle')
    const msgId = insertHintMessage(taskId, 'ignored')

    await orchestrator.dispatchHumanMessage(taskId, 'hint', 'ignored')

    // Inbox file should NOT be created for an idle task.
    const inboxFile = join(stateRoot, taskId, 'inbox.md')
    expect(existsSync(inboxFile)).toBe(false)

    // Message is still undelivered (will be injected on next spawn).
    const row = memDb
      .query('SELECT delivered_at FROM task_messages WHERE id = ?')
      .get(msgId) as { delivered_at: string | null } | null
    expect(row?.delivered_at).toBeNull()
  })

  it("'answer' is a no-op (task unchanged, inbox untouched)", async () => {
    const taskId = insertTask('running')
    const before = memDb
      .query(
        'SELECT agent_status, queue_after, updated_at FROM tasks WHERE id = ?',
      )
      .get(taskId) as {
      agent_status: string
      queue_after: string | null
      updated_at: string
    }

    await orchestrator.dispatchHumanMessage(taskId, 'answer', 'whatever')

    const after = memDb
      .query(
        'SELECT agent_status, queue_after, updated_at FROM tasks WHERE id = ?',
      )
      .get(taskId) as {
      agent_status: string
      queue_after: string | null
      updated_at: string
    }
    expect(after.agent_status).toBe(before.agent_status)
    expect(after.queue_after).toBe(before.queue_after)
    expect(after.updated_at).toBe(before.updated_at)

    // No inbox file either.
    const inboxFile = join(stateRoot, taskId, 'inbox.md')
    expect(existsSync(inboxFile)).toBe(false)
  })

  it("'redirect' on a nonexistent task is a no-op (no error)", async () => {
    // Should not throw.
    await expect(
      orchestrator.dispatchHumanMessage(
        '01HFAKE000000000000000NOPE',
        'redirect',
        'x',
      ),
    ).resolves.toBeUndefined()
  })

  it("'redirect' on a non-running task skips abort + DB update", async () => {
    const taskId = insertTask('idle')

    await orchestrator.dispatchHumanMessage(taskId, 'redirect', 'x')

    const row = memDb
      .query('SELECT agent_status, queue_after FROM tasks WHERE id = ?')
      .get(taskId) as { agent_status: string; queue_after: string | null }
    expect(row.agent_status).toBe('idle')
    expect(row.queue_after).toBeNull()
  })
})
