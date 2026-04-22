import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'
import { addDependencyEdge } from '../src/db/task-dependencies'
import {
  cascadeDependencyFailure,
  wouldCreateCycle,
} from '../src/orchestrator/dependencies'

function seed(db: Database, ids: string[]) {
  db.run(`INSERT INTO users (id, username, display_name) VALUES ('U1','u','u')`)
  db.run(
    `INSERT INTO boards (id, name, created_by, created_at, updated_at)
       VALUES ('B1','b','U1',datetime('now'),datetime('now'))`,
  )
  db.run(
    `INSERT INTO columns (id, board_id, name, position, created_at)
       VALUES ('C1','B1','Todo',0,datetime('now'))`,
  )
  for (const id of ids) {
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, agent_status, created_by, updated_by, created_at, updated_at)
         VALUES (?, 'B1','C1',?,'idle','U1','U1',datetime('now'),datetime('now'))`,
      [id, id],
    )
  }
}

describe('wouldCreateCycle', () => {
  let db: Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.run('PRAGMA foreign_keys = ON')
    createTables(db)
    seed(db, ['A', 'B', 'C', 'D'])
  })

  it('detects a direct self-cycle', () => {
    expect(wouldCreateCycle(db, 'A', 'A')).toBe(true)
  })

  it('detects a 2-node cycle (A→B already, now adding B→A)', () => {
    addDependencyEdge(db, 'A', 'B')
    expect(wouldCreateCycle(db, 'B', 'A')).toBe(true)
  })

  it('detects a 3-node cycle (A→B→C, adding C→A)', () => {
    addDependencyEdge(db, 'A', 'B')
    addDependencyEdge(db, 'B', 'C')
    expect(wouldCreateCycle(db, 'C', 'A')).toBe(true)
  })

  it('allows non-cyclic additions (diamond)', () => {
    addDependencyEdge(db, 'A', 'B')
    addDependencyEdge(db, 'A', 'C')
    expect(wouldCreateCycle(db, 'D', 'B')).toBe(false)
    expect(wouldCreateCycle(db, 'D', 'C')).toBe(false)
  })

  it('handles disconnected components', () => {
    addDependencyEdge(db, 'A', 'B')
    expect(wouldCreateCycle(db, 'C', 'D')).toBe(false)
  })
})

describe('cascadeDependencyFailure', () => {
  let db: Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.run('PRAGMA foreign_keys = ON')
    createTables(db)
    seed(db, ['A', 'B', 'C', 'D'])
  })

  it('moves direct dependents to BLOCKED with reason=DEPENDENCY_FAILED', () => {
    addDependencyEdge(db, 'B', 'A')
    addDependencyEdge(db, 'C', 'A')
    db.run(`UPDATE tasks SET agent_status='queued' WHERE id IN ('B','C')`)

    const affected = cascadeDependencyFailure(db, 'A')
    expect(affected.sort()).toEqual(['B', 'C'])

    const rows = db
      .query(
        "SELECT id, agent_status, block_reason FROM tasks WHERE id IN ('B','C') ORDER BY id",
      )
      .all() as Array<{
      id: string
      agent_status: string
      block_reason: string | null
    }>
    for (const r of rows) {
      expect(r.agent_status).toBe('blocked')
      expect(r.block_reason).toBe('DEPENDENCY_FAILED')
    }
  })

  it('leaves already-SUCCESS dependents untouched', () => {
    addDependencyEdge(db, 'B', 'A')
    db.run(`UPDATE tasks SET agent_status='success' WHERE id='B'`)
    const affected = cascadeDependencyFailure(db, 'A')
    expect(affected).toEqual([])
    const row = db
      .query("SELECT agent_status FROM tasks WHERE id='B'")
      .get() as { agent_status: string }
    expect(row.agent_status).toBe('success')
  })

  it('leaves already-FAILED dependents untouched', () => {
    addDependencyEdge(db, 'B', 'A')
    db.run(`UPDATE tasks SET agent_status='failed' WHERE id='B'`)
    const affected = cascadeDependencyFailure(db, 'A')
    expect(affected).toEqual([])
    const row = db
      .query("SELECT agent_status FROM tasks WHERE id='B'")
      .get() as { agent_status: string }
    expect(row.agent_status).toBe('failed')
  })

  it('leaves RUNNING dependents untouched (no mid-flight abort)', () => {
    addDependencyEdge(db, 'B', 'A')
    db.run(`UPDATE tasks SET agent_status='running' WHERE id='B'`)
    const affected = cascadeDependencyFailure(db, 'A')
    expect(affected).toEqual([])
    const row = db
      .query("SELECT agent_status FROM tasks WHERE id='B'")
      .get() as { agent_status: string }
    expect(row.agent_status).toBe('running')
  })

  it('is idempotent: second call does not re-UPDATE BLOCKED dependents', () => {
    addDependencyEdge(db, 'B', 'A')
    addDependencyEdge(db, 'C', 'A')
    db.run(`UPDATE tasks SET agent_status='queued' WHERE id IN ('B','C')`)
    const first = cascadeDependencyFailure(db, 'A')
    expect(first.sort()).toEqual(['B', 'C'])
    const second = cascadeDependencyFailure(db, 'A')
    expect(second).toEqual([])
  })
})
