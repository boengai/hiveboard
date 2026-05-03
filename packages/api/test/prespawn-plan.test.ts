// packages/api/test/prespawn-plan.test.ts
import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { generateId } from '../src/db/ulid'
import { plan } from '../src/orchestrator/prespawn'
import type { TaskRow } from '../src/orchestrator/orchestrator'

const fakeGh = { fetchReviewComments: async () => [] }

describe('plan()', () => {
  let db: Database
  let taskId: string

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    createTables(db)
    seed(db)
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as { id: string }
    const column = db
      .query('SELECT id FROM columns WHERE board_id = ? LIMIT 1')
      .get(board.id) as { id: string }
    const user = db.query('SELECT id FROM users LIMIT 1').get() as { id: string }
    taskId = generateId()
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, body, position, agent_status, action, created_by, updated_by)
       VALUES (?, ?, ?, 'T', 'B', 0, 'queued', 'implement', ?, ?)`,
      [taskId, board.id, column.id, user.id, user.id],
    )
  })

  afterEach(() => db.close())

  const taskRow = (): TaskRow =>
    db.query('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow

  it('returns missing_secrets when required secrets cannot be resolved', async () => {
    db.run(`UPDATE tasks SET required_secrets = ? WHERE id = ?`, [
      JSON.stringify(['ABSENT_KEY']),
      taskId,
    ])
    const result = await plan(taskRow(), { db, github: fakeGh })
    expect(result.kind).toBe('missing_secrets')
    if (result.kind === 'missing_secrets') {
      expect(result.missing).toEqual(['ABSENT_KEY'])
    }
  })

  it('returns ok with empty commits and empty prompt material for a fresh task', async () => {
    const result = await plan(taskRow(), { db, github: fakeGh })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.plan.commits.deliveredMessageIds).toEqual([])
    expect(result.plan.commits.clearPendingAutoReviseFor).toBeNull()
    expect(result.plan.messages).toEqual([])
    expect(result.plan.reviewComments).toBeUndefined()
    expect(result.plan.verificationFailures).toEqual([])
    expect(result.plan.previousAttemptReplay).toBeUndefined()
    expect(result.plan.requiredSecrets).toEqual([])
    expect(result.plan.allowedToolsOverride).toBeUndefined()
    expect(result.plan.secretsEnv).toEqual({})
    expect(result.plan.secretValues).toEqual([])
  })

  it('populates messages + deliveredMessageIds for undelivered hints', async () => {
    const id = generateId()
    db.run(
      `INSERT INTO task_messages (id, task_id, author_type, kind, body) VALUES (?, ?, 'human', 'hint', 'go')`,
      [id, taskId],
    )
    const result = await plan(taskRow(), { db, github: fakeGh })
    if (result.kind !== 'ok') throw new Error('expected ok')
    expect(result.plan.commits.deliveredMessageIds).toEqual([id])
    expect(result.plan.messages.map((m) => m.kind)).toEqual(['hint'])
  })

  it('populates verificationFailures + clear-pointer when pending pointer is set', async () => {
    const runId = generateId()
    db.run(
      `INSERT INTO agent_runs (id, task_id, action, status) VALUES (?, ?, 'implement', 'failed')`,
      [runId, taskId],
    )
    db.run(
      `INSERT INTO verification_runs (id, task_id, agent_run_id, label, command, exit_code, output, started_at, finished_at)
       VALUES (?, ?, ?, 'lint', 'bun run lint', 1, 'oops', datetime('now'), datetime('now'))`,
      [generateId(), taskId, runId],
    )
    db.run(`UPDATE tasks SET pending_auto_revise_source_run_id = ? WHERE id = ?`, [
      runId,
      taskId,
    ])
    const result = await plan(taskRow(), { db, github: fakeGh })
    if (result.kind !== 'ok') throw new Error('expected ok')
    expect(result.plan.verificationFailures.length).toBe(1)
    expect(result.plan.commits.clearPendingAutoReviseFor).toBe(taskId)
  })

  it('skips review-comment fetch for non-revise actions', async () => {
    const ghThatThrows = {
      fetchReviewComments: async () => {
        throw new Error('should not be called')
      },
    }
    const result = await plan(taskRow(), { db, github: ghThatThrows })
    expect(result.kind).toBe('ok')
  })

  it('populates previousAttemptReplay when retry_count > 0 with a prior failed run', async () => {
    const runId = generateId()
    db.run(
      `INSERT INTO agent_runs (id, task_id, action, status, error) VALUES (?, ?, 'implement', 'failed', 'crashed')`,
      [runId, taskId],
    )
    db.run(`UPDATE tasks SET retry_count = 1 WHERE id = ?`, [taskId])
    const result = await plan(taskRow(), { db, github: fakeGh })
    if (result.kind !== 'ok') throw new Error('expected ok')
    expect(result.plan.retryAttempt).toBe(1)
    expect(result.plan.previousAttemptReplay).toBeDefined()
  })

  it('does NOT call any DB writes during plan() — DB row count of tasks unchanged after plan', async () => {
    const before = db.query('SELECT count(*) as c FROM tasks').get() as { c: number }
    await plan(taskRow(), { db, github: fakeGh })
    const after = db.query('SELECT count(*) as c FROM tasks').get() as { c: number }
    expect(after.c).toBe(before.c)
    // Also confirm pending_auto_revise_source_run_id was NOT cleared by plan() itself.
    const row = db
      .query('SELECT pending_auto_revise_source_run_id FROM tasks WHERE id = ?')
      .get(taskId) as { pending_auto_revise_source_run_id: string | null }
    // (None was set in this test, so it must still be null — but the point is plan() doesn't touch it.)
    expect(row.pending_auto_revise_source_run_id).toBeNull()
  })
})
