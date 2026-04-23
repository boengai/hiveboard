/**
 * orchestrator-playbook-tools.test.ts
 *
 * Blocker 1 regression test.
 *
 * When the orchestrator dispatches a task whose action is `playbook:<name>`,
 * it MUST resolve the playbook's current-version `allowedToolsOverride` and
 * forward it into `runAgent` so the spawned Claude CLI has its tool
 * allow-list clamped per the playbook.
 *
 * Strategy mirrors orchestrator.test.ts: in-memory sqlite singleton, pubsub
 * no-op, and a replaceable `runAgent` mock that captures the options it was
 * called with. The mock must re-export `buildClaudeArgsForTest` per the
 * pattern established in prior orchestrator tests (Task 11).
 */

import { Database } from 'bun:sqlite'
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildClaudeArgsForTest as realBuildClaudeArgsForTest } from '../src/agent/runner'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { generateId } from '../src/db/ulid'

// ---------------------------------------------------------------------------
// In-memory DB + tmp state_root
// ---------------------------------------------------------------------------

const memDb = new Database(':memory:')
memDb.exec('PRAGMA journal_mode = WAL')
memDb.exec('PRAGMA foreign_keys = ON')
createTables(memDb)
seed(memDb)

const stateRoot = mkdtempSync(join(tmpdir(), 'hb-orch-pb-tools-'))

// ---------------------------------------------------------------------------
// Module mocks – registered BEFORE orchestrator import
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

// Mutable capture: last options passed to runAgent.
let lastRunAgentOptions: Record<string, unknown> | null = null

mock.module('../src/agent/runner', () => ({
  buildClaudeArgsForTest: realBuildClaudeArgsForTest,
  runAgent: async (opts: unknown) => {
    lastRunAgentOptions = opts as Record<string, unknown>
    const { task } = opts as { task: { id: string } }
    return { output: 'ok', success: true, taskId: task.id }
  },
}))

const { Orchestrator } = await import('../src/orchestrator/orchestrator')
const { createPlaybook } = await import('../src/playbooks')

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
      allowed_tools: ['Read', 'Edit', 'Bash'],
      command: 'claude',
      max_turns: 5,
      model: undefined,
      permission_mode: undefined,
    },
    hooks: { timeout_ms: 5_000 },
    polling: { interval_ms: 60_000 },
    scheduler: { legacy_mode: false },
    verify: { commands: [], enabled: false, max_auto_revises: 1 },
    workspace: { root: '/tmp/hiveboard-pb-tools-ws', ttl_ms: 0 },
  }
}

function makeGitHubStub() {
  return {
    fetchReviewComments: async () => [],
    findPrByHead: async () => null,
    getAccessToken: async () => 'fake-token',
    getIdentity: async () => ({ email: 'test@test.com', name: 'test[bot]' }),
    getTokenDir: () => '/tmp/hiveboard-pb-tools-tokens',
  }
}

function makeWorkspaceStub() {
  return {
    createForTask: async () => ({ created: true, path: '/tmp/fake-workspace' }),
    sweepExpired: async () => {},
    ttlMs: 0,
  }
}

function insertQueuedTaskWithAction(action: string): string {
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
    `INSERT INTO tasks (id, board_id, column_id, title, body, action, agent_status, retry_count, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
    [id, board.id, col.id, 'PB Tools Task', 'body', action, user.id, user.id],
  )
  return id
}

async function flushMicrotasks(ms = 100) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterAll(() => {
  try {
    rmSync(stateRoot, { force: true, recursive: true })
  } catch {
    // ignore
  }
})

describe('Orchestrator – playbook allowedToolsOverride → runAgent', () => {
  let orchestrator: InstanceType<typeof Orchestrator>

  beforeEach(() => {
    lastRunAgentOptions = null
    orchestrator = new Orchestrator(
      makeConfig() as never,
      makeGitHubStub() as never,
      makeWorkspaceStub() as never,
      'prompt template',
    )
  })

  afterEach(async () => {
    await orchestrator.shutdown()
    memDb.run("DELETE FROM tasks WHERE title = 'PB Tools Task'")
    memDb.run('DELETE FROM agent_runs')
    memDb.run("DELETE FROM task_events WHERE type NOT IN ('created')")
    memDb.run('DELETE FROM playbook_versions')
    memDb.run('DELETE FROM playbooks')
  })

  it("forwards the playbook's allowedToolsOverride into runAgent options", async () => {
    const user = memDb.query('SELECT id FROM users LIMIT 1').get() as {
      id: string
    }
    // Use a test-only playbook name to avoid colliding with seeded playbooks
    // (seed.ts creates `security-review`, `flake-hunt`, etc.).
    createPlaybook(memDb, {
      allowedToolsOverride: ['Read'],
      createdBy: user.id,
      defaultsJson: '{}',
      description: 'Test playbook for allowed-tools forwarding',
      displayName: 'PB Tools Fixture',
      name: 'pb-tools-fixture',
      promptTemplate: 'Please review.',
    })

    insertQueuedTaskWithAction('playbook:pb-tools-fixture')
    await orchestrator.poll()
    await flushMicrotasks()

    expect(lastRunAgentOptions).not.toBeNull()
    const override = (lastRunAgentOptions as { allowedToolsOverride?: unknown })
      .allowedToolsOverride
    expect(override).toEqual(['Read'])
  })

  it('passes undefined when the playbook does not exist (runner falls back to config)', async () => {
    insertQueuedTaskWithAction('playbook:does-not-exist')
    await orchestrator.poll()
    await flushMicrotasks()

    expect(lastRunAgentOptions).not.toBeNull()
    // When no playbook is found we pass `undefined` so the runner picks up
    // the global config allow-list — NOT an empty array (which would disable
    // all tools).
    expect(
      (lastRunAgentOptions as { allowedToolsOverride?: unknown })
        .allowedToolsOverride,
    ).toBeUndefined()
  })

  it('does not set allowedToolsOverride for non-playbook actions', async () => {
    insertQueuedTaskWithAction('plan')
    await orchestrator.poll()
    await flushMicrotasks()

    expect(lastRunAgentOptions).not.toBeNull()
    expect(
      (lastRunAgentOptions as { allowedToolsOverride?: unknown })
        .allowedToolsOverride,
    ).toBeUndefined()
  })
})
