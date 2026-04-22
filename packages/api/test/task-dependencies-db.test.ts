import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'
import {
  addDependencyEdge,
  listBlockers,
  listDependents,
  removeDependencyEdge,
  unresolvedBlockerCount,
} from '../src/db/task-dependencies'

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
  for (const id of ['A', 'B', 'C', 'D']) {
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, agent_status, created_by, updated_by, created_at, updated_at)
         VALUES (?, 'B1','C1',?,'idle','U1','U1',datetime('now'),datetime('now'))`,
      [id, id],
    )
  }
}

describe('task-dependencies DB layer', () => {
  let db: Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.run('PRAGMA foreign_keys = ON')
    createTables(db)
    seed(db)
  })

  it('addDependencyEdge is idempotent (primary key)', () => {
    addDependencyEdge(db, 'B', 'A')
    addDependencyEdge(db, 'B', 'A')
    expect(listBlockers(db, 'B')).toEqual(['A'])
  })

  it('listBlockers / listDependents', () => {
    addDependencyEdge(db, 'B', 'A')
    addDependencyEdge(db, 'C', 'A')
    addDependencyEdge(db, 'C', 'B')
    expect(listBlockers(db, 'C').sort()).toEqual(['A', 'B'])
    expect(listDependents(db, 'A').sort()).toEqual(['B', 'C'])
    expect(listBlockers(db, 'A')).toEqual([])
  })

  it('removeDependencyEdge drops the edge', () => {
    addDependencyEdge(db, 'B', 'A')
    removeDependencyEdge(db, 'B', 'A')
    expect(listBlockers(db, 'B')).toEqual([])
  })

  it('unresolvedBlockerCount counts blockers not in SUCCESS', () => {
    addDependencyEdge(db, 'B', 'A')
    addDependencyEdge(db, 'B', 'C')
    expect(unresolvedBlockerCount(db, 'B')).toBe(2)
    db.run(`UPDATE tasks SET agent_status='success' WHERE id='A'`)
    expect(unresolvedBlockerCount(db, 'B')).toBe(1)
    db.run(`UPDATE tasks SET agent_status='success' WHERE id='C'`)
    expect(unresolvedBlockerCount(db, 'B')).toBe(0)
  })
})
