import { beforeEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createTables } from '../src/db/schema'
import {
  insertCheckpoint,
  listCheckpointsForRun,
  countTurnsForRun,
} from '../src/db/checkpoints'

function seedRun(db: Database, runId: string, taskId: string): void {
  // Mirror the real NOT NULL columns. See schema-checkpoints.test.ts for the
  // pattern that works with the current schema.
  db.run(
    `INSERT OR IGNORE INTO users (id, username, display_name) VALUES ('u1', 'testuser', 'Test User')`,
  )
  db.run(
    `INSERT OR IGNORE INTO boards (id, name, created_by) VALUES ('b1', 'B', 'u1')`,
  )
  // Note: the table is named 'columns', not 'board_columns'
  db.run(
    `INSERT OR IGNORE INTO columns (id, board_id, name, position) VALUES ('c1', 'b1', 'Todo', 0)`,
  )
  db.run(
    `INSERT OR IGNORE INTO tasks (id, board_id, column_id, title, body, position, created_by, updated_by)
     VALUES (?, 'b1', 'c1', 't', '', 0, 'u1', 'u1')`,
    [taskId],
  )
  db.run(
    `INSERT INTO agent_runs (id, task_id, action, status)
     VALUES (?, ?, 'implement', 'success')`,
    [runId, taskId],
  )
}

describe('checkpoint DB accessors', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    createTables(db)
    // Seed two runs on two distinct tasks to verify the WHERE filter.
    seedRun(db, 'run-A', '01HYX3KPQR000000000000000A')
    seedRun(db, 'run-B', '01HYX3KPQR000000000000000B')
  })

  it('inserts and lists checkpoints ordered by turn', () => {
    insertCheckpoint(db, {
      id: 'cp-3',
      agentRunId: 'run-A',
      turn: 3,
      kind: 'tool_use',
      summary: '[tool Read] x',
      rawBytes: 20,
    })
    insertCheckpoint(db, {
      id: 'cp-1',
      agentRunId: 'run-A',
      turn: 1,
      kind: 'assistant',
      summary: 'hi',
      rawBytes: 2,
    })
    insertCheckpoint(db, {
      id: 'cp-other',
      agentRunId: 'run-B',
      turn: 1,
      kind: 'assistant',
      summary: 'other run',
      rawBytes: 9,
    })

    const rows = listCheckpointsForRun(db, 'run-A')
    expect(rows.map((r) => r.turn)).toEqual([1, 3])
    expect(rows.map((r) => r.agentRunId)).toEqual(['run-A', 'run-A'])
    expect(rows[0].kind).toBe('assistant')
    expect(rows[0].summary).toBe('hi')
    expect(rows[0].rawBytes).toBe(2)
    expect(typeof rows[0].occurredAt).toBe('string')
  })

  it('countTurnsForRun returns max(turn) or 0', () => {
    expect(countTurnsForRun(db, 'run-A')).toBe(0)
    insertCheckpoint(db, {
      id: 'cp-1',
      agentRunId: 'run-A',
      turn: 1,
      kind: 'assistant',
      summary: 'a',
      rawBytes: 1,
    })
    insertCheckpoint(db, {
      id: 'cp-9',
      agentRunId: 'run-A',
      turn: 9,
      kind: 'assistant',
      summary: 'b',
      rawBytes: 1,
    })
    expect(countTurnsForRun(db, 'run-A')).toBe(9)
  })

  it('returns empty list for unknown run', () => {
    expect(listCheckpointsForRun(db, 'no-such-run')).toEqual([])
    expect(countTurnsForRun(db, 'no-such-run')).toBe(0)
  })
})
