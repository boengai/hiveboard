/**
 * orchestrator-secrets.test.ts
 *
 * Tests for Task 13 of Plan H:
 * Orchestrator pre-spawn secrets resolution + MISSING_SECRETS gate.
 *
 * Strategy: same in-memory SQLite + mock.module harness as the other
 * orchestrator suites. The secrets modules are set up with _setKekForTest /
 * _setSecretsEnabledForTest so we can control whether the feature is on/off
 * and whether secrets exist in the DB without touching real env vars.
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
import { randomBytes } from 'node:crypto'
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

const stateRoot = mkdtempSync(join(tmpdir(), 'hb-orch-secrets-'))

// ---------------------------------------------------------------------------
// Module mocks – must precede orchestrator import
// ---------------------------------------------------------------------------

mock.module('../src/db', () => ({
  db: memDb,
  generateId,
}))

mock.module('../src/pubsub', () => ({
  publishAgentLog: () => {},
  publishCheckpointAdded: () => {},
  publishCommentAdded: () => {},
  publishMessageAdded: () => {},
  publishScratchpadUpdated: () => {},
  publishTaskEvent: () => {},
  publishTaskMissingSecretsChanged: () => {},
  publishTaskProgress: () => {},
  publishTaskUpdated: () => {},
  publishVerificationRun: () => {},
  publishWorkspaceSnapshot: () => {},
  pubsub: { publish: () => {} },
}))

// Mutable runAgent reference — tests override per-case
let mockRunAgentImpl: (...args: unknown[]) => Promise<unknown> = async (
  opts: unknown,
) => {
  const { task } = opts as { task: { id: string } }
  return { output: 'ok', success: true, taskId: task.id }
}

// Capture runAgent call args for assertions
let capturedRunAgentOptions: unknown = null

mock.module('../src/agent/runner', () => ({
  buildClaudeArgsForTest: realBuildClaudeArgsForTest,
  runAgent: (...args: unknown[]) => {
    capturedRunAgentOptions = args[0]
    return mockRunAgentImpl(...args)
  },
}))

// ---------------------------------------------------------------------------
// Now import orchestrator + secrets helpers (after mocks)
// ---------------------------------------------------------------------------

const { Orchestrator } = await import('../src/orchestrator/orchestrator')
const { selectSchedulableTasks } = await import(
  '../src/orchestrator/scheduler'
)
const { _setKekForTest, _setSecretsEnabledForTest } = await import(
  '../src/secrets/enabled'
)
const { deriveKek } = await import('../src/secrets/encryption')
const { setBoardSecret } = await import('../src/secrets/store')

// ---------------------------------------------------------------------------
// Test KEK — a valid 32-byte base64 key
// ---------------------------------------------------------------------------

const RAW_KEY_BASE64 = randomBytes(32).toString('base64')

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
    workspace: { root: '/tmp/hiveboard-secrets-ws', ttl_ms: 0 },
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

function getBoardAndColumn(): { boardId: string; columnId: string; userId: string } {
  const user = memDb.query('SELECT id FROM users LIMIT 1').get() as {
    id: string
  }
  const board = memDb.query('SELECT id FROM boards LIMIT 1').get() as {
    id: string
  }
  const col = memDb.query('SELECT id FROM columns LIMIT 1').get() as {
    id: string
  }
  return { boardId: board.id, columnId: col.id, userId: user.id }
}

function insertQueuedTaskWithSecrets(
  requiredSecrets: string[],
  agentStatus = 'queued',
): string {
  const { boardId, columnId, userId } = getBoardAndColumn()
  const id = generateId()
  memDb.run(
    `INSERT INTO tasks (id, board_id, column_id, title, body, action, target_repo,
                        agent_status, retry_count, created_by, updated_by, required_secrets)
     VALUES (?, ?, ?, ?, ?, 'implement', NULL, ?, 0, ?, ?, ?)`,
    [
      id,
      boardId,
      columnId,
      'Secrets Test Task',
      'body',
      agentStatus,
      userId,
      userId,
      JSON.stringify(requiredSecrets),
    ],
  )
  return id
}

/** Wait for async side-effects (runAgentAsync fire-and-forget) to settle. */
async function flushAsync(ms = 80): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('orchestrator pre-spawn secrets', () => {
  let orchestrator: InstanceType<typeof Orchestrator>

  beforeEach(() => {
    capturedRunAgentOptions = null
    // Enable secrets with a valid test KEK
    _setKekForTest(deriveKek(RAW_KEY_BASE64))
    _setSecretsEnabledForTest(true)

    mockRunAgentImpl = async (opts: unknown) => {
      const { task } = opts as { task: { id: string } }
      return { output: 'ok', success: true, taskId: task.id }
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
    _setKekForTest(null)
    _setSecretsEnabledForTest(undefined)
    memDb.run("DELETE FROM tasks WHERE title = 'Secrets Test Task'")
    memDb.run('DELETE FROM board_secrets')
    memDb.run('DELETE FROM task_secrets')
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

  it('transitions a task to MISSING_SECRETS when a required secret is absent', async () => {
    // Task requires DATABASE_URL but no secret is seeded
    const taskId = insertQueuedTaskWithSecrets(['DATABASE_URL'])

    // runAgent should NOT be called
    let runAgentCalled = false
    mockRunAgentImpl = async () => {
      runAgentCalled = true
      return { output: '', success: false, taskId }
    }

    // Dispatch the task directly
    const taskRow = memDb
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(taskId) as Parameters<typeof orchestrator.dispatchTask>[0]
    await orchestrator.dispatchTask(taskRow)
    await flushAsync()

    // Task should be in missing_secrets
    const row = memDb
      .query('SELECT agent_status, agent_error FROM tasks WHERE id = ?')
      .get(taskId) as { agent_status: string; agent_error: string | null } | null
    expect(row?.agent_status).toBe('missing_secrets')
    expect(row?.agent_error).toContain('DATABASE_URL')

    // runAgent was NOT called
    expect(runAgentCalled).toBe(false)
  })

  it('does not transition when required_secrets is empty', async () => {
    // Task with no required secrets — should proceed normally
    const taskId = insertQueuedTaskWithSecrets([])

    let runAgentCalled = false
    mockRunAgentImpl = async (opts: unknown) => {
      runAgentCalled = true
      const { task } = opts as { task: { id: string } }
      return { output: 'ok', success: true, taskId: task.id }
    }

    const taskRow = memDb
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(taskId) as Parameters<typeof orchestrator.dispatchTask>[0]
    await orchestrator.dispatchTask(taskRow)
    await flushAsync()

    // runAgent WAS called
    expect(runAgentCalled).toBe(true)

    // Task should NOT be in missing_secrets
    const row = memDb
      .query('SELECT agent_status FROM tasks WHERE id = ?')
      .get(taskId) as { agent_status: string } | null
    expect(row?.agent_status).not.toBe('missing_secrets')
  })

  it('passes resolved values to runAgent as secretsEnv + secretValues when secrets are present', async () => {
    const { boardId, userId } = getBoardAndColumn()

    // Seed a board secret DATABASE_URL=pg://x
    setBoardSecret(memDb, {
      boardId,
      name: 'DATABASE_URL',
      value: 'pg://x',
      userId,
    })

    // Task requires DATABASE_URL
    const taskId = insertQueuedTaskWithSecrets(['DATABASE_URL'])

    const taskRow = memDb
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(taskId) as Parameters<typeof orchestrator.dispatchTask>[0]
    await orchestrator.dispatchTask(taskRow)
    await flushAsync()

    // Captured options should contain secretsEnv and secretValues
    expect(capturedRunAgentOptions).not.toBeNull()
    const opts = capturedRunAgentOptions as {
      secretsEnv?: Record<string, string>
      secretValues?: string[]
    }
    expect(opts.secretsEnv?.DATABASE_URL).toBe('pg://x')
    expect(opts.secretValues).toContain('pg://x')
  })

  it('does not select MISSING_SECRETS tasks for scheduling', () => {
    // Seed a task directly at missing_secrets status
    const taskId = insertQueuedTaskWithSecrets(['DATABASE_URL'], 'missing_secrets')

    const schedulable = selectSchedulableTasks(memDb, {
      legacyMode: false,
      limit: 10,
    })

    const ids = schedulable.map((t) => t.id)
    expect(ids).not.toContain(taskId)
  })
})
