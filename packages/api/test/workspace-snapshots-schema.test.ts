import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'

describe('workspace_snapshots table', () => {
  it('is created with the expected columns', () => {
    const db = new Database(':memory:')
    createTables(db)
    const cols = db
      .query("PRAGMA table_info('workspace_snapshots')")
      .all() as Array<{ name: string; notnull: number }>
    const names = cols.map((c) => c.name).sort()
    expect(names).toEqual([
      'agent_run_id',
      'captured_at',
      'file_status',
      'id',
      'patch',
      'stat_hash',
      'stat_summary',
      'task_id',
    ])
  })

  it('has idx_workspace_snapshots_task index', () => {
    const db = new Database(':memory:')
    createTables(db)
    const idx = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_workspace_snapshots_task'",
      )
      .get() as { name: string } | null
    expect(idx?.name).toBe('idx_workspace_snapshots_task')
  })

  it('patch column accepts NULL (stats-only snapshots when over disk budget)', () => {
    const db = new Database(':memory:')
    createTables(db)
    db.run(
      `INSERT INTO users (id, username, display_name) VALUES ('U1','u','u')`,
    )
    db.run(`INSERT INTO boards (id, name, created_by) VALUES ('B1','b','U1')`)
    db.run(
      `INSERT INTO columns (id, board_id, name, position) VALUES ('C1','B1','c',0)`,
    )
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, created_by, updated_by)
       VALUES ('01HYX3KPQR000000000000000A','B1','C1','t','U1','U1')`,
    )
    db.run(
      `INSERT INTO workspace_snapshots
         (id, task_id, stat_summary, stat_hash, file_status, patch)
       VALUES ('S1','01HYX3KPQR000000000000000A','stat','hash','[]',NULL)`,
    )
    const row = db
      .query('SELECT patch FROM workspace_snapshots WHERE id = ?')
      .get('S1') as { patch: Uint8Array | null }
    expect(row.patch).toBeNull()
  })

  it('is idempotent when createTables runs twice', () => {
    const db = new Database(':memory:')
    createTables(db)
    createTables(db)
  })
})
