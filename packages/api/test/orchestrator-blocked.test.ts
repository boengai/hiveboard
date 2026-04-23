/**
 * orchestrator-blocked.test.ts
 *
 * Tests for Task 7 of the bidirectional-channel plan: when the agent writes to
 * $HIVEBOARD_QUESTION on exit, the orchestrator should transition the task to
 * BLOCKED, record a task_messages row (kind='question', author_type='agent'),
 * and clean up the on-disk question file.
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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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

// Unique tmp dir for this test suite's agent-state so it doesn't collide with
// other tests that share the default './tmp/agent-state' root.
const stateRoot = mkdtempSync(join(tmpdir(), 'hb-orch-blocked-'))

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

let mockRunAgentImpl: (...args: unknown[]) => Promise<unknown> = async () => ({
  output: 'ok',
  success: true,
  taskId: '',
})

mock.module('../src/agent/runner', () => ({
  buildClaudeArgsForTest: realBuildClaudeArgsForTest,
  runAgent: (...args: unknown[]) => mockRunAgentImpl(...args),
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
    workspace: { root: '/tmp/hiveboard-test-workspaces', ttl_ms: 0 },
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

function insertQueuedTask(): string {
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
     VALUES (?, ?, ?, ?, ?, 'plan', NULL, 'queued', 0, ?, ?)`,
    [id, board.id, col.id, 'Test Blocked Task', 'body', user.id, user.id],
  )
  return id
}

/** Write a question file at the path the orchestrator expects. */
function writeQuestionFile(taskId: string, body: string): string {
  const dir = join(stateRoot, taskId)
  mkdirSync(dir, { recursive: true })
  const p = join(dir, 'question.md')
  writeFileSync(p, body)
  return p
}

async function flushMicrotasks(ms = 100) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Orchestrator – BLOCKED on agent question', () => {
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
    await orchestrator.shutdown()
    memDb.run("DELETE FROM tasks WHERE title = 'Test Blocked Task'")
    memDb.run('DELETE FROM agent_runs')
    memDb.run('DELETE FROM task_messages')
    memDb.run("DELETE FROM task_events WHERE type NOT IN ('created')")
  })

  afterAll(() => {
    // Clean up tmp state_root after the suite so we don't litter /tmp
    try {
      rmSync(stateRoot, { force: true, recursive: true })
    } catch {
      // ignore
    }
  })

  it('transitions to BLOCKED when agent writes a question on success', async () => {
    // We know the id up-front so we can stage the question file before dispatch.
    const taskId = insertQueuedTask()
    const qPath = writeQuestionFile(
      taskId,
      'Should I use TypeScript strict mode or not?',
    )

    mockRunAgentImpl = async () => ({
      output: 'ran successfully but had a question',
      success: true,
      taskId,
    })

    await orchestrator.poll()
    await flushMicrotasks(150)

    // Task is BLOCKED, not SUCCESS.
    const task = memDb
      .query('SELECT agent_status FROM tasks WHERE id = ?')
      .get(taskId) as { agent_status: string } | null
    expect(task?.agent_status).toBe('blocked')

    // block_reason is set to 'QUESTION'
    const row = memDb
      .query('SELECT block_reason FROM tasks WHERE id = ?')
      .get(taskId) as { block_reason: string | null } | null
    expect(row?.block_reason).toBe('QUESTION')

    // agent_runs row reflects the blocked state.
    const run = memDb
      .query('SELECT status, finished_at FROM agent_runs WHERE task_id = ?')
      .get(taskId) as { status: string; finished_at: string | null } | null
    expect(run?.status).toBe('blocked')
    expect(run?.finished_at).not.toBeNull()

    // task_messages row was created with the question body.
    const msg = memDb
      .query(
        `SELECT author_type, kind, body, created_by FROM task_messages
         WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(taskId) as {
      author_type: string
      kind: string
      body: string
      created_by: string | null
    } | null
    expect(msg).not.toBeNull()
    expect(msg?.author_type).toBe('agent')
    expect(msg?.kind).toBe('question')
    expect(msg?.body).toBe('Should I use TypeScript strict mode or not?')
    expect(msg?.created_by).toBeNull()

    // agent_blocked event was recorded.
    const event = memDb
      .query(
        "SELECT type FROM task_events WHERE task_id = ? AND type = 'agent_blocked'",
      )
      .get(taskId) as { type: string } | null
    expect(event).not.toBeNull()

    // Question file was cleaned up.
    expect(existsSync(qPath)).toBe(false)
  })

  it('transitions to BLOCKED even when agent exits with failure', async () => {
    const taskId = insertQueuedTask()
    writeQuestionFile(taskId, 'Which API endpoint should I call?')

    mockRunAgentImpl = async () => ({
      error: 'agent crashed',
      output: '',
      success: false,
      taskId,
    })

    await orchestrator.poll()
    await flushMicrotasks(150)

    // Question wins over failure exit code.
    const task = memDb
      .query('SELECT agent_status FROM tasks WHERE id = ?')
      .get(taskId) as { agent_status: string } | null
    expect(task?.agent_status).toBe('blocked')

    // block_reason is set to 'QUESTION'
    const row = memDb
      .query('SELECT block_reason FROM tasks WHERE id = ?')
      .get(taskId) as { block_reason: string | null } | null
    expect(row?.block_reason).toBe('QUESTION')

    // No agent_failed event should have been recorded.
    const failedEvent = memDb
      .query(
        "SELECT type FROM task_events WHERE task_id = ? AND type = 'agent_failed'",
      )
      .get(taskId) as { type: string } | null
    expect(failedEvent).toBeNull()
  })

  it('follows normal SUCCESS path when no question file exists', async () => {
    const taskId = insertQueuedTask()
    // No question file written.

    mockRunAgentImpl = async () => ({
      output: 'all good',
      success: true,
      taskId,
    })

    await orchestrator.poll()
    await flushMicrotasks(150)

    const task = memDb
      .query('SELECT agent_status FROM tasks WHERE id = ?')
      .get(taskId) as { agent_status: string } | null
    expect(task?.agent_status).toBe('success')

    // No question message row.
    const msg = memDb
      .query(
        "SELECT id FROM task_messages WHERE task_id = ? AND kind = 'question'",
      )
      .get(taskId) as { id: string } | null
    expect(msg).toBeNull()
  })

  it('follows normal SUCCESS path when question file is empty/whitespace', async () => {
    const taskId = insertQueuedTask()
    writeQuestionFile(taskId, '   \n\t  \n')

    mockRunAgentImpl = async () => ({
      output: 'all good',
      success: true,
      taskId,
    })

    await orchestrator.poll()
    await flushMicrotasks(150)

    const task = memDb
      .query('SELECT agent_status FROM tasks WHERE id = ?')
      .get(taskId) as { agent_status: string } | null
    expect(task?.agent_status).toBe('success')
  })
})
