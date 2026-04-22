/**
 * orchestrator-subtasks.test.ts
 *
 * Tests for Task 13: processSubtaskManifest hook — when the agent writes
 * $HIVEBOARD_SUBTASKS on a successful exit, the orchestrator materializes
 * the declared child tasks and emits a subtasks_spawned event. Invalid
 * manifests are renamed to .errored and a subtask_manifest_invalid event
 * is recorded; parent continues to SUCCESS.
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
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { listBlockers } from '../src/db/task-dependencies'
import { generateId } from '../src/db/ulid'

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
const stateRoot = mkdtempSync(join(tmpdir(), 'hb-orch-subtasks-'))

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
  runAgent: async () => ({ output: 'ok', success: true, taskId: '' }),
}))

const { Orchestrator } = await import('../src/orchestrator/orchestrator')

// ---------------------------------------------------------------------------
// YAML fixtures
// ---------------------------------------------------------------------------

const VALID_YAML = `subtasks:
  - title: "child A"
    action: implement
  - title: "child B"
    action: implement
    depends_on_siblings: [0]
`

const INVALID_YAML = `subtasks:
  - title: "bad"
    action: invalid_action
`

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

/**
 * Insert a minimal task with action='plan' (skips the verify gate) and
 * agent_status='running'. Returns the task id.
 */
function insertRunningTask(): string {
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
     VALUES (?, ?, ?, ?, ?, 'plan', NULL, 'running', 0, ?, ?)`,
    [
      id,
      board.id,
      col.id,
      `Subtask-parent-${id.slice(-4)}`,
      'body',
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
 * Write the subtasks.yaml manifest at the expected path for a task.
 * Returns the path written.
 */
function writeManifest(taskId: string, content: string): string {
  const dir = join(stateRoot, taskId)
  mkdirSync(dir, { recursive: true })
  const p = join(dir, 'subtasks.yaml')
  writeFileSync(p, content)
  return p
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Orchestrator – processSubtaskManifest', () => {
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

  it('valid manifest → children spawned with dependency, event recorded, manifest unlinked', async () => {
    const parentId = insertRunningTask()
    const runId = insertRunningAgentRun(parentId)
    const manifestPath = writeManifest(parentId, VALID_YAML)

    const parentRow = memDb
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(parentId) as Parameters<typeof orchestrator._onCompleteForTest>[0]

    await orchestrator._onCompleteForTest(parentRow, runId, {
      output: '',
      success: true,
      taskId: parentId,
    })

    // 2 children exist with parent_task_id = parentId
    const children = memDb
      .query(
        'SELECT id FROM tasks WHERE parent_task_id = ? ORDER BY created_at ASC',
      )
      .all(parentId) as Array<{ id: string }>
    expect(children.length).toBe(2)

    const child0Id = children[0]?.id
    const child1Id = children[1]?.id

    // child B (index 1) depends on child A (index 0)
    const blockers = listBlockers(memDb, child1Id)
    expect(blockers).toEqual([child0Id])

    // task_events has a subtasks_spawned row with count=2 and child_ids
    const event = memDb
      .query(
        `SELECT data FROM task_events WHERE task_id = ? AND type = 'subtasks_spawned'`,
      )
      .get(parentId) as { data: string } | null
    expect(event).not.toBeNull()
    const eventData = JSON.parse(event?.data)
    expect(eventData.count).toBe(2)
    expect(eventData.child_ids).toContain(child0Id)
    expect(eventData.child_ids).toContain(child1Id)

    // manifest file was unlinked
    expect(existsSync(manifestPath)).toBe(false)

    // parent reached SUCCESS
    const parent = memDb
      .query('SELECT agent_status FROM tasks WHERE id = ?')
      .get(parentId) as { agent_status: string } | null
    expect(parent?.agent_status).toBe('success')
  })

  it('invalid manifest → .errored file created, no children, parent still SUCCESS', async () => {
    const parentId = insertRunningTask()
    const runId = insertRunningAgentRun(parentId)
    const manifestPath = writeManifest(parentId, INVALID_YAML)

    const parentRow = memDb
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(parentId) as Parameters<typeof orchestrator._onCompleteForTest>[0]

    await orchestrator._onCompleteForTest(parentRow, runId, {
      output: '',
      success: true,
      taskId: parentId,
    })

    // No children created
    const children = memDb
      .query('SELECT id FROM tasks WHERE parent_task_id = ?')
      .all(parentId) as Array<{ id: string }>
    expect(children.length).toBe(0)

    // Manifest renamed to .errored
    expect(existsSync(manifestPath)).toBe(false)
    expect(existsSync(`${manifestPath}.errored`)).toBe(true)

    // Parent's agent_status is still 'success'
    const parent = memDb
      .query('SELECT agent_status FROM tasks WHERE id = ?')
      .get(parentId) as { agent_status: string } | null
    expect(parent?.agent_status).toBe('success')

    // task_events has subtask_manifest_invalid row
    const event = memDb
      .query(
        `SELECT data FROM task_events WHERE task_id = ? AND type = 'subtask_manifest_invalid'`,
      )
      .get(parentId) as { data: string } | null
    expect(event).not.toBeNull()
    const eventData = JSON.parse(event?.data)
    expect(Array.isArray(eventData.errors)).toBe(true)
    expect(eventData.errors.length).toBeGreaterThan(0)
  })

  it('question + manifest on the same exit → question wins, no subtasks spawned', async () => {
    // When the agent writes BOTH $HIVEBOARD_QUESTION and $HIVEBOARD_SUBTASKS,
    // the onComplete early-return on question must prevent processSubtaskManifest
    // from firing. This is the Plan B order-of-operations guard.
    const parentId = insertRunningTask()
    const runId = insertRunningAgentRun(parentId)
    const manifestPath = writeManifest(parentId, VALID_YAML)

    // Also seed a question file in the same per-task dir.
    const questionPath = join(stateRoot, parentId, 'question.md')
    writeFileSync(questionPath, 'Postgres or MySQL?')

    const parentRow = memDb
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(parentId) as Parameters<typeof orchestrator._onCompleteForTest>[0]

    await orchestrator._onCompleteForTest(parentRow, runId, {
      output: '',
      success: true,
      taskId: parentId,
    })

    // Parent → BLOCKED with block_reason='QUESTION'
    const parent = memDb
      .query('SELECT agent_status, block_reason FROM tasks WHERE id = ?')
      .get(parentId) as {
      agent_status: string
      block_reason: string | null
    } | null
    expect(parent?.agent_status).toBe('blocked')
    expect(parent?.block_reason).toBe('QUESTION')

    // No subtasks created
    const children = memDb
      .query('SELECT id FROM tasks WHERE parent_task_id = ?')
      .all(parentId) as Array<{ id: string }>
    expect(children.length).toBe(0)

    // Manifest file untouched — early-return skipped subtask processing
    expect(existsSync(manifestPath)).toBe(true)
    expect(existsSync(`${manifestPath}.errored`)).toBe(false)

    // subtasks_spawned event NOT emitted
    const spawnEvent = memDb
      .query(
        `SELECT id FROM task_events WHERE task_id = ? AND type = 'subtasks_spawned'`,
      )
      .get(parentId)
    expect(spawnEvent).toBeNull()
  })
})
