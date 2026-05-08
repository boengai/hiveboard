/**
 * orchestrator-dep-cascade.test.ts
 *
 * Tests for Task 6: dependency notifications.
 * - FAILED blocker → dependents transition to BLOCKED with DEPENDENCY_FAILED
 * - SUCCESS blocker → dependents receive TASK_UPDATED re-render events
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
const stateRoot = mkdtempSync(join(tmpdir(), 'hb-orch-dep-cascade-'))

// ---------------------------------------------------------------------------
// Capture array for pubsub.publish calls — populated by the mock below.
// We use a module-level array and reset it in afterEach.
// ---------------------------------------------------------------------------

const publishedEvents: Array<{
  channel: string
  boardId: string
  payload: unknown
}> = []

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
    publish: (channel: string, boardId: string, payload: unknown) => {
      publishedEvents.push({ boardId, channel, payload })
    },
  },
}))

mock.module('../src/agent/runner', () => ({
  buildClaudeArgsForTest: realBuildClaudeArgsForTest,
  runAgent: async () => ({ output: 'ok', success: true, taskId: '' }),
}))

const { Orchestrator } = await import('../src/orchestrator/orchestrator')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Insert a minimal task with the given agent_status and return its id.
 * Uses action='plan' so that the SUCCESS path skips the verify gate entirely.
 */
function insertTask(agentStatus: string): string {
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
      `Task-${id.slice(-4)}`,
      'body',
      agentStatus,
      user.id,
      user.id,
    ],
  )
  return id
}

/**
 * Insert a running agent_runs row for a task and return the run id.
 */
function insertRunningAgentRun(taskId: string): string {
  const runId = generateId()
  memDb.run(
    `INSERT INTO agent_runs (id, task_id, action, status, started_at)
     VALUES (?, ?, 'plan', 'running', datetime('now'))`,
    [runId, taskId],
  )
  return runId
}

/**
 * Insert a dependency edge: taskId depends on blockerId
 * (i.e., blockerId must succeed before taskId can run).
 */
function insertDependency(taskId: string, blockerId: string): void {
  memDb.run(
    `INSERT INTO task_dependencies (task_id, blocker_id) VALUES (?, ?)`,
    [taskId, blockerId],
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('orchestrator dependency cascade', () => {
  let orchestrator: InstanceType<typeof Orchestrator>

  beforeEach(() => {
    // Clear events capture array for each test
    publishedEvents.length = 0

    orchestrator = new Orchestrator(
      makeConfig(stateRoot) as never,
      makeGitHubStub() as never,
      makeWorkspaceStub() as never,
      'prompt template',
    )
  })

  afterEach(async () => {
    await orchestrator.shutdown()
    memDb.run('DELETE FROM task_dependencies')
    memDb.run('DELETE FROM agent_runs')
    memDb.run('DELETE FROM task_messages')
    memDb.run("DELETE FROM task_events WHERE type NOT IN ('created')")
    memDb.run('DELETE FROM tasks')
  })

  afterAll(() => {
    try {
      rmSync(stateRoot, { force: true, recursive: true })
    } catch {
      // ignore
    }
  })

  it('cascades FAILED blocker → dependents BLOCKED with DEPENDENCY_FAILED', async () => {
    // Task A is the blocker (running → will fail)
    const taskAId = insertTask('running')
    const runAId = insertRunningAgentRun(taskAId)

    // Task B depends on A (queued, waiting on A)
    const taskBId = insertTask('queued')
    insertDependency(taskBId, taskAId)

    // Fetch task A row as the orchestrator would see it
    const taskARow = memDb
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(taskAId) as Parameters<typeof orchestrator._onCompleteForTest>[0]

    // Drive A through the FAILED path
    await orchestrator._onCompleteForTest(taskARow, runAId, {
      error: 'boom',
      output: '',
      success: false,
      taskId: taskAId,
    })

    // A is now failed
    const taskA = memDb
      .query('SELECT agent_status FROM tasks WHERE id = ?')
      .get(taskAId) as { agent_status: string } | null
    expect(taskA?.agent_status).toBe('failed')

    // B is now blocked with DEPENDENCY_FAILED
    const taskB = memDb
      .query('SELECT agent_status, block_reason FROM tasks WHERE id = ?')
      .get(taskBId) as {
      agent_status: string
      block_reason: string | null
    } | null
    expect(taskB?.agent_status).toBe('blocked')
    expect(taskB?.block_reason).toBe('DEPENDENCY_FAILED')

    // The (B → A) edge is still present — we do NOT auto-prune
    const edge = memDb
      .query(
        'SELECT 1 FROM task_dependencies WHERE task_id = ? AND blocker_id = ?',
      )
      .get(taskBId, taskAId) as unknown
    expect(edge).not.toBeNull()
  })

  it('publishes TASK_UPDATED for dependents when blocker reaches SUCCESS', async () => {
    // Task A is the blocker (running → will succeed)
    const taskAId = insertTask('running')
    const runAId = insertRunningAgentRun(taskAId)

    // Task B depends on A
    const taskBId = insertTask('queued')
    insertDependency(taskBId, taskAId)

    // Fetch task A row as the orchestrator would see it
    const taskARow = memDb
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(taskAId) as Parameters<typeof orchestrator._onCompleteForTest>[0]

    // Drive A through the SUCCESS path
    await orchestrator._onCompleteForTest(taskARow, runAId, {
      output: 'all done',
      success: true,
      taskId: taskAId,
    })

    // A is now success
    const taskA = memDb
      .query('SELECT agent_status FROM tasks WHERE id = ?')
      .get(taskAId) as { agent_status: string } | null
    expect(taskA?.agent_status).toBe('success')

    // Check that TASK_UPDATED was published for B (the dependent)
    const taskUpdatesForB = publishedEvents.filter(
      (ev) =>
        ev.channel === 'TASK_UPDATED' &&
        (ev.payload as { id?: string })?.id === taskBId,
    )
    expect(taskUpdatesForB.length).toBeGreaterThan(0)
  })
})
