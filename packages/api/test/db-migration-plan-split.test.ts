import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'

function seedRow(db: Database, id: string, body: string) {
  db.run(
    `INSERT INTO tasks (id, board_id, column_id, title, body, created_by, updated_by)
     VALUES (?, 'b', 'c', 't', ?, 'u', 'u')`,
    [id, body],
  )
}

function setup(): Database {
  const db = new Database(':memory:')
  createTables(db)
  db.run(`INSERT INTO users (id, username, display_name) VALUES ('u', 'u', 'u')`)
  db.run(`INSERT INTO boards (id, name, created_by) VALUES ('b', 'b', 'u')`)
  db.run(
    `INSERT INTO columns (id, board_id, name, position) VALUES ('c', 'b', 'Todo', 0)`,
  )
  return db
}

describe('plan-split migration', () => {
  it('adds plan column', () => {
    const db = setup()
    const cols = db
      .query("PRAGMA table_info('tasks')")
      .all() as Array<{ name: string }>
    expect(cols.some((c) => c.name === 'plan')).toBe(true)
  })

  it('backfills body containing legacy ## Implementation Plan section', () => {
    const db = setup()
    seedRow(
      db,
      't1',
      'My requirement.\n\n## Implementation Plan\n\nStep one.\nStep two.',
    )
    createTables(db)
    const row = db
      .query('SELECT body, plan FROM tasks WHERE id = ?')
      .get('t1') as { body: string; plan: string | null }
    expect(row.body).toBe('My requirement.')
    expect(row.plan).toBe('Step one.\nStep two.')
  })

  it('leaves body without the heading unchanged', () => {
    const db = setup()
    seedRow(db, 't2', 'Just a requirement, no plan section.')
    createTables(db)
    const row = db
      .query('SELECT body, plan FROM tasks WHERE id = ?')
      .get('t2') as { body: string; plan: string | null }
    expect(row.body).toBe('Just a requirement, no plan section.')
    expect(row.plan).toBeNull()
  })

  it('is idempotent — second run is a no-op on already-split rows', () => {
    const db = setup()
    seedRow(db, 't3', 'Req.\n\n## Implementation Plan\n\nPlan body.')
    createTables(db)
    const after1 = db
      .query('SELECT body, plan FROM tasks WHERE id = ?')
      .get('t3') as { body: string; plan: string | null }
    createTables(db)
    const after2 = db
      .query('SELECT body, plan FROM tasks WHERE id = ?')
      .get('t3') as { body: string; plan: string | null }
    expect(after2).toEqual(after1)
  })
})
