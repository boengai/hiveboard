import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'
import {
  listBlockers,
  unresolvedBlockerCount,
} from '../src/db/task-dependencies'
import { selectSchedulableTasks } from '../src/orchestrator/scheduler'
import { createSubtasksFromManifest } from '../src/orchestrator/subtasks'

function seedParent(db: Database) {
  db.run(`INSERT INTO users (id, username, display_name) VALUES ('U1','u','u')`)
  db.run(
    `INSERT INTO boards (id, name, created_by, created_at, updated_at)
       VALUES ('B1','b','U1',datetime('now'),datetime('now'))`,
  )
  db.run(
    `INSERT INTO columns (id, board_id, name, position, created_at)
       VALUES ('C1','B1','Todo',0,datetime('now'))`,
  )
  db.run(
    `INSERT INTO tasks (id, board_id, column_id, title, target_repo, target_branch, created_by, updated_by, created_at, updated_at)
       VALUES ('P','B1','C1','parent','acme/repo','main','U1','U1',datetime('now'),datetime('now'))`,
  )
}

describe('subtask roll-up DAG walk', () => {
  let db: Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.run('PRAGMA foreign_keys = ON')
    createTables(db)
    seedParent(db)
  })

  it('spawns A/B (B depends on A), schedules them in order, and reports full success', () => {
    const [idA, idB] = createSubtasksFromManifest(
      db,
      'P',
      {
        subtasks: [
          {
            action: 'implement',
            body: '',
            depends_on_siblings: [],
            tags: [],
            target_branch: null,
            title: 'A',
          },
          {
            action: 'implement',
            body: '',
            depends_on_siblings: [0],
            tags: [],
            target_branch: null,
            title: 'B',
          },
        ],
      },
      'U1',
    )

    // Round 1: only A schedulable
    expect(unresolvedBlockerCount(db, idB!)).toBe(1)
    expect(
      selectSchedulableTasks(db, { legacyMode: false, limit: 10 }).map(
        (t) => t.id,
      ),
    ).toEqual([idA])

    // A completes
    db.run(`UPDATE tasks SET agent_status = 'success' WHERE id = ?`, [idA])

    // Round 2: B schedulable
    expect(unresolvedBlockerCount(db, idB!)).toBe(0)
    expect(
      selectSchedulableTasks(db, { legacyMode: false, limit: 10 }).map(
        (t) => t.id,
      ),
    ).toEqual([idB])

    // B completes
    db.run(`UPDATE tasks SET agent_status = 'success' WHERE id = ?`, [idB])

    // Edge still exists — we don't prune on success (audit trail)
    expect(listBlockers(db, idB!)).toEqual([idA])

    const kids = db
      .query(
        `SELECT id, agent_status FROM tasks WHERE parent_task_id = 'P' ORDER BY id`,
      )
      .all() as Array<{ id: string; agent_status: string }>
    expect(kids.every((k) => k.agent_status === 'success')).toBe(true)
  })
})
