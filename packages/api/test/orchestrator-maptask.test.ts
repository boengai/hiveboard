/**
 * orchestrator-maptask.test.ts
 *
 * Blocker 2 regression test.
 *
 * The orchestrator's private `mapTask` serializes a TaskRow into the shape
 * that ships in TASK_UPDATED pubsub payloads. Historically it uppercased
 * `action` because action used to be a closed enum (PLAN / IMPLEMENT / …).
 * The schema resolvers' own `mapTask` was updated when the enum was removed
 * but the orchestrator's copy wasn't, which corrupted playbook actions like
 * `playbook:bump-dep` to `PLAYBOOK:BUMP-DEP` on the wire and broke the
 * frontend's select-value matching.
 *
 * Because `mapTask` is private, we exercise it via the publish path: stub
 * `pubsub.publish`, dispatch a task whose action is `playbook:bump-dep`,
 * and assert the TASK_UPDATED payload's `action` field is the verbatim
 * string.
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
import {
  flushMicrotasks,
  makeConfig,
  makeGitHubStub,
  makeWorkspaceStub,
} from './helpers/fixtures'

// ---------------------------------------------------------------------------
// In-memory DB + tmp state_root
// ---------------------------------------------------------------------------

const memDb = new Database(':memory:')
memDb.exec('PRAGMA journal_mode = WAL')
memDb.exec('PRAGMA foreign_keys = ON')
createTables(memDb)
seed(memDb)

const stateRoot = mkdtempSync(join(tmpdir(), 'hb-orch-maptask-'))

// ---------------------------------------------------------------------------
// Capture every pubsub publish so we can inspect TASK_UPDATED payloads.
// ---------------------------------------------------------------------------

type PublishedEvent = {
  topic: string
  key: string
  payload: Record<string, unknown>
}
const publishedEvents: PublishedEvent[] = []

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
  publishTaskUpdated: (key: string, payload: Record<string, unknown>) => {
    publishedEvents.push({ key, payload, topic: 'TASK_UPDATED' })
  },
  publishVerificationRun: () => {},
  publishWorkspaceSnapshot: () => {},
  pubsub: {
    publish: (
      topic: string,
      key: string,
      payload: Record<string, unknown>,
    ) => {
      publishedEvents.push({ key, payload, topic })
    },
  },
}))

mock.module('../src/agent/runner', () => ({
  buildClaudeArgsForTest: realBuildClaudeArgsForTest,
  runAgent: async (opts: unknown) => {
    const { task } = opts as { task: { id: string } }
    return { output: 'ok', success: true, taskId: task.id }
  },
}))

const { Orchestrator } = await import('../src/orchestrator/orchestrator')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    [id, board.id, col.id, 'MapTask Test', 'body', action, user.id, user.id],
  )
  return id
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

describe('Orchestrator – mapTask preserves verbatim action', () => {
  let orchestrator: InstanceType<typeof Orchestrator>

  beforeEach(() => {
    publishedEvents.length = 0
    orchestrator = new Orchestrator(
      makeConfig(stateRoot, { workspaceRoot: '/tmp/hiveboard-maptask-ws' }) as never,
      makeGitHubStub({ tokenDir: '/tmp/hiveboard-maptask-tokens' }) as never,
      makeWorkspaceStub() as never,
      'prompt template',
    )
  })

  afterEach(async () => {
    await orchestrator.shutdown()
    memDb.run("DELETE FROM tasks WHERE title = 'MapTask Test'")
    memDb.run('DELETE FROM agent_runs')
    memDb.run("DELETE FROM task_events WHERE type NOT IN ('created')")
  })

  /**
   * Filter helper: only the TASK_UPDATED payloads emitted while the task
   * still has a non-null action (i.e. before `onComplete` clears action to
   * NULL on success). Those are the ones we care about — if any of them
   * upper-case the action we'd break frontend select-value matching.
   */
  function updatesWithAction(): Array<Record<string, unknown>> {
    return publishedEvents
      .filter((e) => e.topic === 'TASK_UPDATED')
      .map((e) => e.payload)
      .filter((p) => (p as { action?: string | null }).action != null)
  }

  it('round-trips playbook:bump-dep verbatim in TASK_UPDATED payloads', async () => {
    insertQueuedTaskWithAction('playbook:bump-dep')

    await orchestrator.poll()
    await flushMicrotasks()

    const updates = updatesWithAction()
    expect(updates.length).toBeGreaterThan(0)
    // Every pre-completion TASK_UPDATED payload must carry `action`
    // verbatim — NO upper-casing — so the frontend's select matches.
    for (const payload of updates) {
      const action = (payload as { action?: string | null }).action
      expect(action).toBe('playbook:bump-dep')
    }
  })

  it('round-trips lower-case built-in actions verbatim too (not upper-cased)', async () => {
    insertQueuedTaskWithAction('plan')

    await orchestrator.poll()
    await flushMicrotasks()

    const updates = updatesWithAction()
    expect(updates.length).toBeGreaterThan(0)
    for (const payload of updates) {
      const action = (payload as { action?: string | null }).action
      expect(action).toBe('plan')
    }
  })
})
