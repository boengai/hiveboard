import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'
import { addDependencyEdge } from '../src/db/task-dependencies'
import { selectSchedulableTasks } from '../src/orchestrator/scheduler'

function seedChain(db: Database, chain: string[]) {
  db.run(`INSERT INTO users (id, username, display_name) VALUES ('U1','u','u')`)
  db.run(
    `INSERT INTO boards (id, name, created_by, created_at, updated_at)
       VALUES ('B1','b','U1',datetime('now'),datetime('now'))`,
  )
  db.run(
    `INSERT INTO columns (id, board_id, name, position, created_at)
       VALUES ('C1','B1','Todo',0,datetime('now'))`,
  )
  for (const id of chain) {
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, action, agent_status, created_by, updated_by, created_at, updated_at)
         VALUES (?, 'B1','C1',?,'implement','queued','U1','U1',datetime('now'),datetime('now'))`,
      [id, id],
    )
  }
  for (let i = 1; i < chain.length; i++) {
    addDependencyEdge(db, chain[i]!, chain[i - 1]!)
  }
}

describe('scheduler DAG integration', () => {
  let db: Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.run('PRAGMA foreign_keys = ON')
    createTables(db)
    seedChain(db, ['A', 'B', 'C'])
  })

  it('walks A → B → C in order as each completes', () => {
    let pick = selectSchedulableTasks(db, { legacyMode: false, limit: 10 })
    expect(pick.map((t) => t.id)).toEqual(['A'])

    db.run(`UPDATE tasks SET agent_status='success' WHERE id='A'`)
    pick = selectSchedulableTasks(db, { legacyMode: false, limit: 10 })
    expect(pick.map((t) => t.id)).toEqual(['B'])

    db.run(`UPDATE tasks SET agent_status='success' WHERE id='B'`)
    pick = selectSchedulableTasks(db, { legacyMode: false, limit: 10 })
    expect(pick.map((t) => t.id)).toEqual(['C'])
  })

  it('BLOCKED-QUESTION tasks are NOT schedulable (Plan B regression guard)', () => {
    db.run(
      `UPDATE tasks SET agent_status='blocked', block_reason='QUESTION' WHERE id='A'`,
    )
    const pick = selectSchedulableTasks(db, { legacyMode: false, limit: 10 })
    // Dep-aware SELECT filters on agent_status='queued' — BLOCKED rows never
    // appear. answerQuestion flips BLOCKED → QUEUED at which point the dep
    // filter picks them up.
    expect(pick.map((t) => t.id)).toEqual([])
  })
})
