import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'

describe('secrets schema', () => {
  it('creates board_secrets with required columns', () => {
    const db = new Database(':memory:')
    createTables(db)
    const cols = db
      .query("PRAGMA table_info('board_secrets')")
      .all() as Array<{ name: string; type: string; notnull: number }>
    const byName = new Map(cols.map((c) => [c.name, c]))
    expect(byName.get('id')?.type).toBe('TEXT')
    expect(byName.get('board_id')?.type).toBe('TEXT')
    expect(byName.get('name')?.type).toBe('TEXT')
    expect(byName.get('encrypted_value')?.type).toBe('BLOB')
    expect(byName.get('description')?.type).toBe('TEXT')
    for (const name of ['id', 'board_id', 'name', 'encrypted_value', 'created_by']) {
      expect(byName.get(name)?.notnull).toBe(1)
    }
  })

  it('creates task_secrets with required columns', () => {
    const db = new Database(':memory:')
    createTables(db)
    const cols = db
      .query("PRAGMA table_info('task_secrets')")
      .all() as Array<{ name: string; type: string; notnull: number }>
    const byName = new Map(cols.map((c) => [c.name, c]))
    expect(byName.get('id')?.type).toBe('TEXT')
    expect(byName.get('task_id')?.type).toBe('TEXT')
    expect(byName.get('name')?.type).toBe('TEXT')
    expect(byName.get('encrypted_value')?.type).toBe('BLOB')
  })

  it('enforces UNIQUE (board_id, name) on board_secrets', () => {
    const db = new Database(':memory:')
    createTables(db)
    db.run(`INSERT INTO users (id, username, display_name) VALUES ('U1', 'u', 'U') ON CONFLICT DO NOTHING`)
    db.run(`INSERT INTO boards (id, name, created_by) VALUES ('B1', 'b', 'U1')`)
    db.run(
      `INSERT INTO board_secrets (id, board_id, name, encrypted_value, created_by)
       VALUES ('S1', 'B1', 'DATABASE_URL', X'00', 'U1')`,
    )
    expect(() =>
      db.run(
        `INSERT INTO board_secrets (id, board_id, name, encrypted_value, created_by)
         VALUES ('S2', 'B1', 'DATABASE_URL', X'00', 'U1')`,
      ),
    ).toThrow()
  })

  it('enforces UNIQUE (task_id, name) on task_secrets', () => {
    const db = new Database(':memory:')
    createTables(db)
    db.run(`INSERT INTO users (id, username, display_name) VALUES ('U1', 'u', 'U') ON CONFLICT DO NOTHING`)
    db.run(`INSERT INTO boards (id, name, created_by) VALUES ('B1', 'b', 'U1')`)
    db.run(`INSERT INTO columns (id, board_id, name, position) VALUES ('C1', 'B1', 'todo', 0)`)
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, body, position, created_by, updated_by)
       VALUES ('T1', 'B1', 'C1', 't', '', 0, 'U1', 'U1')`,
    )
    db.run(
      `INSERT INTO task_secrets (id, task_id, name, encrypted_value, created_by)
       VALUES ('S1', 'T1', 'API_KEY', X'00', 'U1')`,
    )
    expect(() =>
      db.run(
        `INSERT INTO task_secrets (id, task_id, name, encrypted_value, created_by)
         VALUES ('S2', 'T1', 'API_KEY', X'00', 'U1')`,
      ),
    ).toThrow()
  })

  it('adds tasks.required_secrets column with default "[]"', () => {
    const db = new Database(':memory:')
    createTables(db)
    const cols = db
      .query("PRAGMA table_info('tasks')")
      .all() as Array<{ name: string; dflt_value: string | null; notnull: number }>
    const row = cols.find((c) => c.name === 'required_secrets')
    expect(row).toBeDefined()
    expect(row?.notnull).toBe(1)
    expect(String(row?.dflt_value)).toContain('[]')
  })

  it('tasks row created without specifying required_secrets defaults to "[]"', () => {
    const db = new Database(':memory:')
    createTables(db)
    db.run(`INSERT INTO users (id, username, display_name) VALUES ('U1', 'u', 'U') ON CONFLICT DO NOTHING`)
    db.run(`INSERT INTO boards (id, name, created_by) VALUES ('B1', 'b', 'U1')`)
    db.run(`INSERT INTO columns (id, board_id, name, position) VALUES ('C1', 'B1', 'todo', 0)`)
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, body, position, created_by, updated_by)
       VALUES ('T1', 'B1', 'C1', 't', '', 0, 'U1', 'U1')`,
    )
    const row = db
      .query('SELECT required_secrets FROM tasks WHERE id = ?')
      .get('T1') as { required_secrets: string }
    expect(row.required_secrets).toBe('[]')
  })
})
