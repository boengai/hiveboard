import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'
import { addDependencyEdge } from '../src/db/task-dependencies'
import { selectSchedulableTasks } from '../src/orchestrator/orchestrator'

function seed(db: Database) {
  db.run(`INSERT INTO users (id, username, display_name) VALUES ('U1','u','u')`)
  db.run(
    `INSERT INTO boards (id, name, created_by, created_at, updated_at)
       VALUES ('B1','b','U1',datetime('now'),datetime('now'))`,
  )
  db.run(
    `INSERT INTO columns (id, board_id, name, position, created_at)
       VALUES ('C1','B1','Todo',0,datetime('now'))`,
  )
  for (const id of ['A', 'B', 'C']) {
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, action, agent_status, created_by, updated_by, created_at, updated_at)
         VALUES (?, 'B1','C1',?,'implement','queued','U1','U1',datetime('now'),datetime('now'))`,
      [id, id],
    )
  }
}

describe('selectSchedulableTasks (dep-aware)', () => {
  let db: Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.run('PRAGMA foreign_keys = ON')
    createTables(db)
    seed(db)
  })

  it('returns queued tasks with no blockers', () => {
    const rows = selectSchedulableTasks(db, { legacyMode: false, limit: 10 })
    expect(rows.map((r) => r.id).sort()).toEqual(['A', 'B', 'C'])
  })

  it('excludes a task whose blocker is not SUCCESS', () => {
    addDependencyEdge(db, 'B', 'A')
    const rows = selectSchedulableTasks(db, { legacyMode: false, limit: 10 })
    expect(rows.map((r) => r.id).sort()).toEqual(['A', 'C'])
  })

  it('schedules dependents once the blocker reaches SUCCESS', () => {
    addDependencyEdge(db, 'B', 'A')
    db.run(`UPDATE tasks SET agent_status='success' WHERE id='A'`)
    const rows = selectSchedulableTasks(db, { legacyMode: false, limit: 10 })
    expect(rows.map((r) => r.id).sort()).toEqual(['B', 'C'])
  })

  it('orders deeper nodes first', () => {
    addDependencyEdge(db, 'B', 'A')
    addDependencyEdge(db, 'C', 'B')
    db.run(`UPDATE tasks SET agent_status='success' WHERE id IN ('A','B')`)
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, action, agent_status, created_by, updated_by, created_at, updated_at)
         VALUES ('D','B1','C1','D','implement','queued','U1','U1',datetime('now','-10 seconds'),datetime('now','-10 seconds'))`,
    )
    const rows = selectSchedulableTasks(db, { legacyMode: false, limit: 10 })
    expect(rows.map((r) => r.id)).toEqual(['C', 'D'])
  })

  it('ignores dependencies when legacyMode=true', () => {
    addDependencyEdge(db, 'B', 'A')
    const rows = selectSchedulableTasks(db, { legacyMode: true, limit: 10 })
    expect(rows.map((r) => r.id).sort()).toEqual(['A', 'B', 'C'])
  })

  it('skips BLOCKED tasks (not schedulable at all)', () => {
    db.run(
      `UPDATE tasks SET agent_status='blocked', block_reason='QUESTION' WHERE id='A'`,
    )
    const rows = selectSchedulableTasks(db, { legacyMode: false, limit: 10 })
    expect(rows.map((r) => r.id).sort()).toEqual(['B', 'C'])
  })
})
