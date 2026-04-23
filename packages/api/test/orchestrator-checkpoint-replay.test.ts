import { beforeEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createTables } from '../src/db/schema'
import { insertCheckpoint } from '../src/db/checkpoints'
import { buildPreviousAttemptReplay } from '../src/orchestrator/orchestrator'

const TASK_ID_1 = '01HYX3KPQR000000000000000A'
const TASK_ID_2 = '01HYX3KPQR000000000000000B'

function seedTask(db: Database, taskId: string): void {
  db.run(`INSERT OR IGNORE INTO users (id, username, display_name, role)
          VALUES ('sys', 'sys', 'System', 'member')`)
  db.run(`INSERT OR IGNORE INTO boards (id, name, created_by)
          VALUES ('b1', 'B', 'sys')`)
  db.run(`INSERT OR IGNORE INTO columns (id, board_id, name, position)
          VALUES ('c1', 'b1', 'Todo', 0)`)
  db.run(
    `INSERT INTO tasks (id, board_id, column_id, title, body, position,
       created_by, updated_by)
     VALUES (?, 'b1', 'c1', 't', '', 0, 'sys', 'sys')`,
    [taskId],
  )
}

function seedRun(
  db: Database,
  runId: string,
  taskId: string,
  status: string,
  error: string | null,
  startedOffsetSec: number,
): void {
  db.run(
    `INSERT INTO agent_runs (id, task_id, action, status, error, started_at)
     VALUES (?, ?, 'implement', ?, ?, datetime('now', ? || ' seconds'))`,
    [runId, taskId, status, error, String(startedOffsetSec)],
  )
}

describe('buildPreviousAttemptReplay', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    createTables(db)
    seedTask(db, TASK_ID_1)
    seedTask(db, TASK_ID_2)
  })

  it('returns null when no prior failed run exists', () => {
    expect(buildPreviousAttemptReplay(db, TASK_ID_2)).toBeNull()
  })

  it('builds a replay from the most recent failed run', () => {
    seedRun(db, 'run-failed', TASK_ID_1, 'failed', 'exit code 1: tests failed', -10)
    for (let i = 1; i <= 25; i++) {
      insertCheckpoint(db, {
        agentRunId: 'run-failed',
        id: `cp-${i}`,
        kind: i === 20 ? 'error' : i % 5 === 0 ? 'tool_use' : 'assistant',
        rawBytes: 10,
        summary: `turn ${i}`,
        turn: i,
      })
    }
    const replay = buildPreviousAttemptReplay(db, TASK_ID_1)
    expect(replay).not.toBeNull()
    expect(replay!.turn_count).toBe(25)
    expect(replay!.failure_summary).toContain('exit code 1')
    expect(replay!.checkpoints.length).toBeGreaterThan(0)
    expect(replay!.checkpoints.length).toBeLessThanOrEqual(50)
    expect(replay!.checkpoints.some((cp) => cp.kind === 'error')).toBe(true)
    expect(replay!.checkpoints.some((cp) => cp.turn === 25)).toBe(true)
  })

  it('returns null when the most recent SUCCESS came after the last FAILED run', () => {
    // Scenario: prior failure → then success → now we retry after success → no replay.
    seedRun(db, 'run-old-fail', TASK_ID_1, 'failed', 'boom', -30)
    seedRun(db, 'run-success', TASK_ID_1, 'success', null, -10)
    insertCheckpoint(db, {
      agentRunId: 'run-old-fail',
      id: 'cp-old',
      kind: 'error',
      rawBytes: 5,
      summary: '[error] boom',
      turn: 5,
    })
    expect(buildPreviousAttemptReplay(db, TASK_ID_1)).toBeNull()
  })

  it('picks the FAILED run AFTER the most recent SUCCESS', () => {
    seedRun(db, 'run-old-fail', TASK_ID_1, 'failed', 'old-failure', -30)
    seedRun(db, 'run-success', TASK_ID_1, 'success', null, -20)
    seedRun(db, 'run-recent-fail', TASK_ID_1, 'failed', 'recent-failure', -5)
    insertCheckpoint(db, {
      agentRunId: 'run-old-fail',
      id: 'cp-old',
      kind: 'error',
      rawBytes: 5,
      summary: '[error] old',
      turn: 1,
    })
    insertCheckpoint(db, {
      agentRunId: 'run-recent-fail',
      id: 'cp-recent',
      kind: 'assistant',
      rawBytes: 5,
      summary: 'trying recently',
      turn: 1,
    })
    const replay = buildPreviousAttemptReplay(db, TASK_ID_1)
    expect(replay).not.toBeNull()
    expect(replay!.failure_summary).toContain('recent-failure')
    expect(replay!.checkpoints.some((cp) => cp.summary === 'trying recently')).toBe(true)
    expect(replay!.checkpoints.some((cp) => cp.summary === '[error] old')).toBe(false)
  })

  it('returns a no-checkpoints replay when the failed run has no checkpoints', () => {
    seedRun(db, 'run-nocp', TASK_ID_1, 'failed', 'died early', -1)
    const replay = buildPreviousAttemptReplay(db, TASK_ID_1)
    expect(replay).not.toBeNull()
    expect(replay!.checkpoints).toEqual([])
    expect(replay!.turn_count).toBe(0)
    expect(replay!.failure_summary).toBe('died early')
  })
})

describe('buildPreviousAttemptReplay — fail_verify + tie-break', () => {
  it('picks fail_verify as the prior attempt (auto-revise path)', () => {
    const db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    createTables(db)
    seedTask(db, TASK_ID_1)
    seedRun(db, 'run-verify', TASK_ID_1, 'fail_verify', 'lint exit 1', -10)
    insertCheckpoint(db, {
      agentRunId: 'run-verify',
      id: 'cp-v1',
      kind: 'error',
      rawBytes: 5,
      summary: '[error] lint exit 1',
      turn: 1,
    })
    const replay = buildPreviousAttemptReplay(db, TASK_ID_1)
    expect(replay).not.toBeNull()
    expect(replay!.failure_summary).toContain('lint exit 1')
  })

  it('tie-breaks same-second runs by id (ULID monotonic)', () => {
    const db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    createTables(db)
    seedTask(db, TASK_ID_1)
    // Two runs inserted at the same datetime (explicit string literal).
    const SAME_TIME = '2026-04-23T12:00:00'
    db.run(
      `INSERT INTO agent_runs (id, task_id, action, status, error, started_at)
       VALUES (?, ?, 'implement', 'success', null, ?)`,
      ['AAAAAAAAAAAAAAAAAAAAAAAAAA', TASK_ID_1, SAME_TIME],
    )
    db.run(
      `INSERT INTO agent_runs (id, task_id, action, status, error, started_at)
       VALUES (?, ?, 'implement', 'failed', 'post-success failure', ?)`,
      ['ZZZZZZZZZZZZZZZZZZZZZZZZZZ', TASK_ID_1, SAME_TIME],
    )
    // With pure `started_at > ?` filter, the Z-id failed run would be missed.
    // With the id tie-break, it IS picked.
    const replay = buildPreviousAttemptReplay(db, TASK_ID_1)
    expect(replay).not.toBeNull()
    expect(replay!.failure_summary).toContain('post-success failure')
  })
})
