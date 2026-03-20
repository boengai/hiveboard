import { Database } from 'bun:sqlite'
import { describe, test, expect, beforeEach } from 'bun:test'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { generateId } from '../src/db/ulid'

let db: Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  createTables(db)
  seed(db)
})

describe('migration', () => {
  test('createTables runs without error on a fresh DB', () => {
    const freshDb = new Database(':memory:')
    freshDb.exec('PRAGMA foreign_keys = ON')
    expect(() => createTables(freshDb)).not.toThrow()
    freshDb.close()
  })

  test('all expected tables exist', () => {
    const tables = db
      .query(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>
    const tableNames = tables.map(t => t.name)

    expect(tableNames).toContain('users')
    expect(tableNames).toContain('boards')
    expect(tableNames).toContain('columns')
    expect(tableNames).toContain('tasks')
    expect(tableNames).toContain('task_comments')
    expect(tableNames).toContain('task_events')
    expect(tableNames).toContain('agent_runs')
  })
})

describe('seed', () => {
  test('creates exactly 1 user: queen-bee with role admin', () => {
    const users = db.query('SELECT * FROM users').all() as Array<{
      username: string
      role: string
      display_name: string
    }>
    expect(users).toHaveLength(1)
    expect(users[0]?.username).toBe('queen-bee')
    expect(users[0]?.role).toBe('admin')
    expect(users[0]?.display_name).toBe('Queen Bee')
  })

  test('creates exactly 1 board named HiveBoard', () => {
    const boards = db.query('SELECT * FROM boards').all() as Array<{ name: string }>
    expect(boards).toHaveLength(1)
    expect(boards[0]?.name).toBe('HiveBoard')
  })

  test('creates exactly 5 columns with correct names and positions', () => {
    const columns = db
      .query('SELECT name, position FROM columns ORDER BY position ASC')
      .all() as Array<{ name: string; position: number }>

    expect(columns).toHaveLength(5)

    const expected = [
      { name: 'Backlog', position: 0 },
      { name: 'Todo', position: 1 },
      { name: 'In Progress', position: 2 },
      { name: 'Review', position: 3 },
      { name: 'Done', position: 4 },
    ]
    for (let i = 0; i < expected.length; i++) {
      expect(columns[i]?.name).toBe(expected[i]?.name)
      expect(columns[i]?.position).toBe(expected[i]?.position)
    }
  })

  test('columns belong to the seeded board', () => {
    const board = db.query('SELECT id FROM boards').get() as { id: string }
    const columns = db
      .query('SELECT board_id FROM columns')
      .all() as Array<{ board_id: string }>
    for (const col of columns) {
      expect(col.board_id).toBe(board.id)
    }
  })

  test('idempotent: re-running seed does not duplicate data', () => {
    seed(db)
    seed(db)

    const users = db.query('SELECT COUNT(*) as c FROM users').get() as { c: number }
    const boards = db.query('SELECT COUNT(*) as c FROM boards').get() as { c: number }
    const columns = db.query('SELECT COUNT(*) as c FROM columns').get() as { c: number }

    expect(users.c).toBe(1)
    expect(boards.c).toBe(1)
    expect(columns.c).toBe(5)
  })
})

describe('foreign key constraints', () => {
  test('inserting a task with a non-existent board_id fails', () => {
    const user = db.query('SELECT id FROM users LIMIT 1').get() as { id: string }
    const col = db.query('SELECT id FROM columns LIMIT 1').get() as { id: string }

    expect(() => {
      db.run(
        `INSERT INTO tasks (id, board_id, column_id, title, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [generateId(), 'nonexistent-board', col.id, 'Test', user.id, user.id]
      )
    }).toThrow()
  })

  test('inserting a task with a non-existent column_id fails', () => {
    const user = db.query('SELECT id FROM users LIMIT 1').get() as { id: string }
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as { id: string }

    expect(() => {
      db.run(
        `INSERT INTO tasks (id, board_id, column_id, title, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [generateId(), board.id, 'nonexistent-col', 'Test', user.id, user.id]
      )
    }).toThrow()
  })

  test('deleting a board cascades to columns', () => {
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as { id: string }
    db.run('DELETE FROM boards WHERE id = ?', [board.id])
    const columns = db.query('SELECT COUNT(*) as c FROM columns').get() as { c: number }
    expect(columns.c).toBe(0)
  })

  test('deleting a task cascades to task_events and task_comments', () => {
    const user = db.query('SELECT id FROM users LIMIT 1').get() as { id: string }
    const board = db.query('SELECT id FROM boards LIMIT 1').get() as { id: string }
    const col = db.query('SELECT id FROM columns LIMIT 1').get() as { id: string }

    const taskId = generateId()
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [taskId, board.id, col.id, 'Test Task', user.id, user.id]
    )
    db.run(
      'INSERT INTO task_events (id, task_id, actor, type) VALUES (?, ?, ?, ?)',
      [generateId(), taskId, user.id, 'created']
    )
    db.run(
      'INSERT INTO task_comments (id, task_id, body, created_by) VALUES (?, ?, ?, ?)',
      [generateId(), taskId, 'A comment', user.id]
    )

    db.run('DELETE FROM tasks WHERE id = ?', [taskId])

    const events = db
      .query('SELECT COUNT(*) as c FROM task_events WHERE task_id = ?')
      .get(taskId) as { c: number }
    const comments = db
      .query('SELECT COUNT(*) as c FROM task_comments WHERE task_id = ?')
      .get(taskId) as { c: number }

    expect(events.c).toBe(0)
    expect(comments.c).toBe(0)
  })
})
