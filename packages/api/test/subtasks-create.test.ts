import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'
import { listBlockers } from '../src/db/task-dependencies'
import {
  createSubtasksFromManifest,
  type SubtaskManifest,
} from '../src/orchestrator/subtasks'

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
    `INSERT INTO columns (id, board_id, name, position, created_at)
       VALUES ('C2','B1','In Progress',1,datetime('now'))`,
  )
  db.run(
    `INSERT INTO tags (id, board_id, name, color) VALUES ('T1','B1','db','#000000')`,
  )
  db.run(
    `INSERT INTO tasks (id, board_id, column_id, title, target_repo, target_branch, created_by, updated_by, created_at, updated_at)
       VALUES ('P','B1','C2','parent','acme/repo','main','U1','U1',datetime('now'),datetime('now'))`,
  )
  db.run(`INSERT INTO task_tags (task_id, tag_id) VALUES ('P','T1')`)
}

const MANIFEST: SubtaskManifest = {
  subtasks: [
    {
      action: 'implement',
      body: 'Do A',
      depends_on_siblings: [],
      tags: ['db'],
      target_branch: null,
      title: 'A',
    },
    {
      action: 'implement',
      body: 'Do B',
      depends_on_siblings: [0],
      tags: [],
      target_branch: 'feature/b',
      title: 'B',
    },
  ],
}

describe('createSubtasksFromManifest', () => {
  let db: Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.run('PRAGMA foreign_keys = ON')
    createTables(db)
    seedParent(db)
  })

  it('creates children with inherited board/repo/branch and sibling dep edges', () => {
    const created = createSubtasksFromManifest(db, 'P', MANIFEST, 'U1')
    expect(created).toHaveLength(2)

    const childA = db
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(created[0]) as Record<string, unknown>
    expect(childA.parent_task_id).toBe('P')
    expect(childA.board_id).toBe('B1')
    expect(childA.target_repo).toBe('acme/repo')
    expect(childA.target_branch).toBe('main')
    expect(childA.action).toBe('implement')
    expect(childA.agent_status).toBe('queued')

    const childB = db
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(created[1]) as Record<string, unknown>
    expect(childB.target_branch).toBe('feature/b')
    expect(listBlockers(db, created[1]!)).toEqual([created[0]])
  })

  it('inherits parent tags', () => {
    const created = createSubtasksFromManifest(db, 'P', MANIFEST, 'U1')
    const tagsA = db
      .query('SELECT tag_id FROM task_tags WHERE task_id = ?')
      .all(created[0]) as Array<{ tag_id: string }>
    expect(tagsA.map((t) => t.tag_id)).toContain('T1')
  })

  it('places children in the board first column (matches createTask default)', () => {
    const created = createSubtasksFromManifest(db, 'P', MANIFEST, 'U1')
    const childA = db
      .query('SELECT column_id FROM tasks WHERE id = ?')
      .get(created[0]) as { column_id: string }
    expect(childA.column_id).toBe('C1')
  })

  it('rolls back the whole batch on any single-row failure', () => {
    const badManifest: SubtaskManifest = {
      subtasks: [
        {
          action: 'implement',
          body: '',
          depends_on_siblings: [],
          tags: ['does-not-exist'],
          target_branch: null,
          title: 'X',
        },
      ],
    }
    expect(() =>
      createSubtasksFromManifest(db, 'P', badManifest, 'U1'),
    ).toThrow()
    const count = db
      .query(`SELECT COUNT(*) AS n FROM tasks WHERE parent_task_id = 'P'`)
      .get() as { n: number }
    expect(count.n).toBe(0)
  })
})
