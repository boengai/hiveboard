/**
 * orchestrator-verify-gate.test.ts
 *
 * Integration tests for the verify-gate hook in Orchestrator.onComplete:
 *  1. All-green verification on IMPLEMENT → success, column moved to Review
 *  2. Failing verification under max_auto_revises → auto-REVISE queued
 *  3. Failing verification at the cap → task FAILED
 *  4. max_auto_revises=0 → immediate FAILED on first failure
 *  5. verify.enabled=false → existing success path unchanged
 *  6. Only applies to implement/revise (PLAN skips verification)
 *
 * Strategy: same as orchestrator.test.ts — in-memory SQLite, pubsub no-op,
 * controllable runAgent mock. Uses a real tmpdir for the workspace path so
 * Bun.spawn('sh -c exit N') has a valid cwd. Uses _onCompleteForTest to
 * invoke the private onComplete with a pre-seeded RunState in `running`.
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
  makeConfig as makeSharedConfig,
  makeGitHubStub as makeSharedGitHubStub,
  makeWorkspaceStub as makeSharedWorkspaceStub,
} from './helpers/fixtures'
import { listVerificationRunsForTask } from '../src/db/verification-runs'

// ---------------------------------------------------------------------------
// In-memory DB + filesystem setup
// ---------------------------------------------------------------------------

const memDb = new Database(':memory:')
memDb.exec('PRAGMA journal_mode = WAL')
memDb.exec('PRAGMA foreign_keys = ON')
createTables(memDb)
seed(memDb)

const stateRoot = mkdtempSync(join(tmpdir(), 'hb-vg-state-'))
const wsRoot = mkdtempSync(join(tmpdir(), 'hb-vg-ws-'))

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
  runAgent: async (opts: unknown) => {
    const { task } = opts as { task: { id: string } }
    return { output: 'agent output', success: true, taskId: task.id }
  },
}))

const { Orchestrator } = await import('../src/orchestrator/orchestrator')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TaskDbRow = {
  id: string
  board_id: string
  column_id: string
  title: string
  body: string
  action: string | null
  agent_status: string
  agent_error: string | null
  verify_attempt_count: number
  pending_auto_revise_source_run_id: string | null
  queue_after: string | null
  pr_url: string | null
}

function makeConfig(verifyOverrides: Record<string, unknown> = {}) {
  return makeSharedConfig(stateRoot, {
    workspaceRoot: wsRoot,
    verify: { commands: [], enabled: true, max_auto_revises: 1, ...verifyOverrides },
  })
}

function makeGitHubStub() {
  return makeSharedGitHubStub({ tokenDir: '/tmp/hiveboard-vg-tokens' })
}

/** Real workspace path so Bun.spawn cwd is valid */
function makeWorkspaceStub(path: string) {
  return makeSharedWorkspaceStub({ path })
}

function getUser() {
  return memDb.query('SELECT id FROM users LIMIT 1').get() as { id: string }
}

function getBoard() {
  return memDb.query('SELECT id FROM boards LIMIT 1').get() as { id: string }
}

function getColumn(name: string) {
  const board = getBoard()
  return memDb
    .query('SELECT id FROM columns WHERE board_id = ? AND name = ? LIMIT 1')
    .get(board.id, name) as { id: string } | null
}

/** Insert a task in the given column with the given action + verify fields. */
function insertTask(opts: {
  action: string
  agentStatus?: string
  verifyAttemptCount?: number
  pendingAutoReviseSourceRunId?: string | null
}): string {
  const user = getUser()
  const board = getBoard()
  const col = memDb.query('SELECT id FROM columns LIMIT 1').get() as {
    id: string
  }
  const id = generateId()
  memDb.run(
    `INSERT INTO tasks (id, board_id, column_id, title, body, action, agent_status,
                        verify_attempt_count, pending_auto_revise_source_run_id,
                        retry_count, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      board.id,
      col.id,
      'Verify Gate Task',
      'body',
      opts.action,
      opts.agentStatus ?? 'queued',
      opts.verifyAttemptCount ?? 0,
      opts.pendingAutoReviseSourceRunId ?? null,
      user.id,
      user.id,
    ],
  )
  return id
}

/** Insert a running agent_run row and return its id. */
function insertAgentRun(taskId: string, action: string): string {
  const runId = generateId()
  memDb.run(
    `INSERT INTO agent_runs (id, task_id, action, status, started_at)
     VALUES (?, ?, ?, 'running', datetime('now'))`,
    [runId, taskId, action],
  )
  return runId
}

function getTask(id: string): TaskDbRow | null {
  return memDb
    .query('SELECT * FROM tasks WHERE id = ?')
    .get(id) as TaskDbRow | null
}

function getAgentRun(runId: string) {
  return memDb.query('SELECT * FROM agent_runs WHERE id = ?').get(runId) as {
    id: string
    status: string
    error: string | null
  } | null
}

async function _flushMicrotasks(ms = 150) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(() => {
  try {
    rmSync(stateRoot, { force: true, recursive: true })
    rmSync(wsRoot, { force: true, recursive: true })
  } catch {
    // ignore
  }
})

// ---------------------------------------------------------------------------
// Shared workspace path (real dir for Bun.spawn)
// ---------------------------------------------------------------------------

const fakeWorkspacePath = wsRoot

// ---------------------------------------------------------------------------
// Scenario helpers: seed a running task and invoke _onCompleteForTest
// ---------------------------------------------------------------------------

/**
 * Seed a task + agent_run as if the agent just finished, inject a RunState
 * into the orchestrator's private `running` map, then call _onCompleteForTest.
 */
async function runScenario(
  orchestrator: InstanceType<typeof Orchestrator>,
  taskId: string,
  action: string,
  workspacePath: string = fakeWorkspacePath,
) {
  // Mark task as running (dispatchTask normally does this)
  memDb.run(
    `UPDATE tasks SET agent_status = 'running', updated_at = datetime('now') WHERE id = ?`,
    [taskId],
  )
  const runId = insertAgentRun(taskId, action)

  // Inject a minimal RunState into the private `running` map so verifyAndGate
  // can retrieve workspacePath from this.running.get(task.id)
  let resolveDone!: () => void
  const done = new Promise<void>((r) => {
    resolveDone = r
  })
  const runningMap = (
    orchestrator as unknown as { running: Map<string, unknown> }
  ).running
  runningMap.set(taskId, {
    abortController: new AbortController(),
    done,
    resolveDone,
    retryAttempt: 0,
    startedAt: new Date(),
    taskId,
    workspacePath,
  })

  const task = memDb.query('SELECT * FROM tasks WHERE id = ?').get(taskId) as {
    id: string
    board_id: string
    column_id: string
    title: string
    body: string
    action: string | null
    agent_instruction: string | null
    target_repo: string | null
    target_branch: string | null
    pr_url: string | null
    agent_status: string
    agent_output: string | null
    agent_error: string | null
    queue_after: string | null
    retry_count: number
    archived: number
    archived_at: string | null
    created_by: string
    updated_by: string
    created_at: string
    updated_at: string
  }

  await orchestrator._onCompleteForTest(task, runId, {
    output: 'agent finished',
    success: true,
    taskId,
  })

  // Clean up running map entry (normally done in runAgentAsync finally)
  runningMap.delete(taskId)
  resolveDone()

  return runId
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Orchestrator verify-gate – scenario 1: all-green on IMPLEMENT', () => {
  let orchestrator: InstanceType<typeof Orchestrator>

  beforeEach(() => {
    orchestrator = new Orchestrator(
      makeConfig({
        commands: [{ label: 'ok', run: 'exit 0', timeout_ms: 5000 }],
        enabled: true,
        max_auto_revises: 1,
      }) as never,
      makeGitHubStub() as never,
      makeWorkspaceStub(fakeWorkspacePath) as never,
      'prompt template',
    )
  })

  afterEach(async () => {
    await orchestrator.shutdown()
    memDb.run("DELETE FROM tasks WHERE title = 'Verify Gate Task'")
    memDb.run('DELETE FROM agent_runs')
    memDb.run('DELETE FROM verification_runs')
    memDb.run("DELETE FROM task_events WHERE type NOT IN ('created')")
  })

  it('task ends in success, column moved to Review, verify_attempt_count=0, 1 green verification_run', async () => {
    const taskId = insertTask({ action: 'implement' })
    await runScenario(orchestrator, taskId, 'implement')

    const task = getTask(taskId)
    expect(task?.agent_status).toBe('success')
    expect(task?.action).toBeNull()
    expect(task?.verify_attempt_count).toBe(0)

    // Should be in Review column
    const reviewCol = getColumn('Review')
    expect(reviewCol).not.toBeNull()
    expect(task?.column_id).toBe(reviewCol?.id)

    // One green verification_run
    const runs = listVerificationRunsForTask(memDb, taskId)
    expect(runs).toHaveLength(1)
    expect(runs[0].exitCode).toBe(0)
  })
})

describe('Orchestrator verify-gate – scenario 2: fail under max_auto_revises', () => {
  let orchestrator: InstanceType<typeof Orchestrator>

  beforeEach(() => {
    orchestrator = new Orchestrator(
      makeConfig({
        commands: [{ label: 'nope', run: 'exit 1', timeout_ms: 5000 }],
        enabled: true,
        max_auto_revises: 1,
      }) as never,
      makeGitHubStub() as never,
      makeWorkspaceStub(fakeWorkspacePath) as never,
      'prompt template',
    )
  })

  afterEach(async () => {
    await orchestrator.shutdown()
    memDb.run("DELETE FROM tasks WHERE title = 'Verify Gate Task'")
    memDb.run('DELETE FROM agent_runs')
    memDb.run('DELETE FROM verification_runs')
    memDb.run("DELETE FROM task_events WHERE type NOT IN ('created')")
  })

  it('task is queued for revise, verify_attempt_count=1, source run set to fail_verify', async () => {
    const taskId = insertTask({ action: 'implement', verifyAttemptCount: 0 })
    const sourceRunId = await runScenario(orchestrator, taskId, 'implement')

    const task = getTask(taskId)
    expect(task?.agent_status).toBe('queued')
    expect(task?.action).toBe('revise')
    expect(task?.verify_attempt_count).toBe(1)
    expect(task?.pending_auto_revise_source_run_id).toBe(sourceRunId)
    expect(task?.queue_after).not.toBeNull()

    // Review column: task should NOT be in Review (no move happened)
    const reviewCol = getColumn('Review')
    expect(task?.column_id).not.toBe(reviewCol?.id)

    // verification_runs should have the failing row
    const vruns = listVerificationRunsForTask(memDb, taskId)
    expect(vruns).toHaveLength(1)
    expect(vruns[0].exitCode).toBe(1)

    // Source agent_run updated to fail_verify
    const run = getAgentRun(sourceRunId)
    expect(run?.status).toBe('fail_verify')
  })
})

describe('Orchestrator verify-gate – scenario 3: fail at cap → FAILED', () => {
  let orchestrator: InstanceType<typeof Orchestrator>

  beforeEach(() => {
    orchestrator = new Orchestrator(
      makeConfig({
        commands: [{ label: 'nope', run: 'exit 1', timeout_ms: 5000 }],
        enabled: true,
        max_auto_revises: 1,
      }) as never,
      makeGitHubStub() as never,
      makeWorkspaceStub(fakeWorkspacePath) as never,
      'prompt template',
    )
  })

  afterEach(async () => {
    await orchestrator.shutdown()
    memDb.run("DELETE FROM tasks WHERE title = 'Verify Gate Task'")
    memDb.run('DELETE FROM agent_runs')
    memDb.run('DELETE FROM verification_runs')
    memDb.run("DELETE FROM task_events WHERE type NOT IN ('created')")
  })

  it('task transitions to FAILED with correct error message, pending pointer cleared', async () => {
    // verify_attempt_count=1 with max_auto_revises=1 → nextAttempt=2 > cap=1 → FAILED
    const taskId = insertTask({ action: 'revise', verifyAttemptCount: 1 })
    const sourceRunId = await runScenario(orchestrator, taskId, 'revise')

    const task = getTask(taskId)
    expect(task?.agent_status).toBe('failed')
    expect(task?.agent_error).toContain('verification failed after 1 attempt')
    expect(task?.pending_auto_revise_source_run_id).toBeNull()

    // Verification run history preserved
    const vruns = listVerificationRunsForTask(memDb, taskId)
    expect(vruns).toHaveLength(1)
    expect(vruns[0].exitCode).toBe(1)

    // Source agent_run updated to failed
    const run = getAgentRun(sourceRunId)
    expect(run?.status).toBe('failed')
  })
})

describe('Orchestrator verify-gate – scenario 4: max_auto_revises=0 → immediate FAILED', () => {
  let orchestrator: InstanceType<typeof Orchestrator>

  beforeEach(() => {
    orchestrator = new Orchestrator(
      makeConfig({
        commands: [{ label: 'nope', run: 'exit 1', timeout_ms: 5000 }],
        enabled: true,
        max_auto_revises: 0,
      }) as never,
      makeGitHubStub() as never,
      makeWorkspaceStub(fakeWorkspacePath) as never,
      'prompt template',
    )
  })

  afterEach(async () => {
    await orchestrator.shutdown()
    memDb.run("DELETE FROM tasks WHERE title = 'Verify Gate Task'")
    memDb.run('DELETE FROM agent_runs')
    memDb.run('DELETE FROM verification_runs')
    memDb.run("DELETE FROM task_events WHERE type NOT IN ('created')")
  })

  it('task goes to FAILED immediately; no auto-revise dispatched', async () => {
    const taskId = insertTask({ action: 'implement', verifyAttemptCount: 0 })
    await runScenario(orchestrator, taskId, 'implement')

    const task = getTask(taskId)
    expect(task?.agent_status).toBe('failed')
    // No auto-revise dispatched: action should be NULL
    expect(task?.action).toBeNull()
  })
})

describe('Orchestrator verify-gate – scenario 5: verify.enabled=false → success unchanged', () => {
  let orchestrator: InstanceType<typeof Orchestrator>

  beforeEach(() => {
    orchestrator = new Orchestrator(
      makeConfig({
        commands: [{ label: 'failing', run: 'exit 1', timeout_ms: 5000 }],
        enabled: false,
        max_auto_revises: 1,
      }) as never,
      makeGitHubStub() as never,
      makeWorkspaceStub(fakeWorkspacePath) as never,
      'prompt template',
    )
  })

  afterEach(async () => {
    await orchestrator.shutdown()
    memDb.run("DELETE FROM tasks WHERE title = 'Verify Gate Task'")
    memDb.run('DELETE FROM agent_runs')
    memDb.run('DELETE FROM verification_runs')
    memDb.run("DELETE FROM task_events WHERE type NOT IN ('created')")
  })

  it('task → SUCCESS with column move; no verification_runs created', async () => {
    const taskId = insertTask({ action: 'implement' })
    await runScenario(orchestrator, taskId, 'implement')

    const task = getTask(taskId)
    expect(task?.agent_status).toBe('success')

    const reviewCol = getColumn('Review')
    expect(task?.column_id).toBe(reviewCol?.id)

    expect(listVerificationRunsForTask(memDb, taskId)).toHaveLength(0)
  })
})

describe('Orchestrator verify-gate – scenario 6: PLAN skips verification', () => {
  let orchestrator: InstanceType<typeof Orchestrator>

  beforeEach(() => {
    orchestrator = new Orchestrator(
      makeConfig({
        commands: [{ label: 'failing', run: 'exit 1', timeout_ms: 5000 }],
        enabled: true,
        max_auto_revises: 1,
      }) as never,
      makeGitHubStub() as never,
      makeWorkspaceStub(fakeWorkspacePath) as never,
      'prompt template',
    )
  })

  afterEach(async () => {
    await orchestrator.shutdown()
    memDb.run("DELETE FROM tasks WHERE title = 'Verify Gate Task'")
    memDb.run('DELETE FROM agent_runs')
    memDb.run('DELETE FROM verification_runs')
    memDb.run("DELETE FROM task_events WHERE type NOT IN ('created')")
  })

  it('PLAN action → SUCCESS with no verification_runs (gate not applied)', async () => {
    const taskId = insertTask({ action: 'plan' })
    await runScenario(orchestrator, taskId, 'plan')

    const task = getTask(taskId)
    expect(task?.agent_status).toBe('success')
    expect(listVerificationRunsForTask(memDb, taskId)).toHaveLength(0)
  })
})
