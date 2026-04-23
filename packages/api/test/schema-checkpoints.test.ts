import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'

describe('agent_run_checkpoints schema', () => {
  it('creates the table with required columns', () => {
    const db = new Database(':memory:')
    createTables(db)
    const cols = db
      .query(`PRAGMA table_info('agent_run_checkpoints')`)
      .all() as Array<{ name: string; type: string; notnull: number }>
    const byName = new Map(cols.map((c) => [c.name, c]))
    expect(byName.get('id')?.type).toBe('TEXT')
    expect(byName.get('agent_run_id')?.type).toBe('TEXT')
    expect(byName.get('turn')?.type).toBe('INTEGER')
    expect(byName.get('kind')?.type).toBe('TEXT')
    expect(byName.get('summary')?.type).toBe('TEXT')
    expect(byName.get('raw_bytes')?.type).toBe('INTEGER')
    expect(byName.get('occurred_at')?.type).toBe('TEXT')
    for (const name of ['agent_run_id', 'turn', 'kind', 'summary', 'raw_bytes']) {
      expect(byName.get(name)?.notnull).toBe(1)
    }
  })

  it('creates the (agent_run_id, turn) index', () => {
    const db = new Database(':memory:')
    createTables(db)
    const idx = db
      .query(`PRAGMA index_list('agent_run_checkpoints')`)
      .all() as Array<{ name: string }>
    expect(idx.some((i) => i.name === 'idx_checkpoints_run')).toBe(true)
  })

  it('cascades on agent_run delete', () => {
    const db = new Database(':memory:')
    createTables(db)
    db.run('PRAGMA foreign_keys = ON')
    // Seed a user (required by boards.created_by and tasks.created_by/updated_by)
    db.run(
      `INSERT INTO users (id, username, display_name) VALUES ('u1', 'testuser', 'Test User')`,
    )
    db.run(
      `INSERT INTO boards (id, name, created_by) VALUES ('b1', 'B', 'u1')`,
    )
    // Note: the table is named 'columns', not 'board_columns'
    db.run(
      `INSERT INTO columns (id, board_id, name, position) VALUES ('c1', 'b1', 'Todo', 0)`,
    )
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, body, position, created_by, updated_by)
       VALUES ('01HYX3KPQR000000000000000A', 'b1', 'c1', 't', '', 0, 'u1', 'u1')`,
    )
    db.run(
      `INSERT INTO agent_runs (id, task_id, action, status)
       VALUES ('run-1', '01HYX3KPQR000000000000000A', 'implement', 'success')`,
    )
    db.run(
      `INSERT INTO agent_run_checkpoints
       (id, agent_run_id, turn, kind, summary, raw_bytes)
       VALUES ('cp-1', 'run-1', 1, 'assistant', 's', 10)`,
    )
    db.run(`DELETE FROM agent_runs WHERE id = 'run-1'`)
    const rows = db
      .query('SELECT id FROM agent_run_checkpoints')
      .all() as Array<unknown>
    expect(rows.length).toBe(0)
  })
})
