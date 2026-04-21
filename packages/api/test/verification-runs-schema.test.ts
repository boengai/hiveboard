import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'

describe('verification_runs table', () => {
  it('is created with the expected columns', () => {
    const db = new Database(':memory:')
    createTables(db)
    const cols = db
      .query("PRAGMA table_info('verification_runs')")
      .all() as Array<{ name: string }>
    const names = cols.map((c) => c.name).sort()
    expect(names).toEqual([
      'agent_run_id',
      'command',
      'exit_code',
      'finished_at',
      'id',
      'label',
      'output',
      'started_at',
      'task_id',
    ])
  })

  it('has idx_verification_runs_task index', () => {
    const db = new Database(':memory:')
    createTables(db)
    const idx = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_verification_runs_task'",
      )
      .get() as { name: string } | null
    expect(idx?.name).toBe('idx_verification_runs_task')
  })
})

describe('tasks.verify_attempt_count column', () => {
  it('exists with default 0', () => {
    const db = new Database(':memory:')
    createTables(db)
    const cols = db.query("PRAGMA table_info('tasks')").all() as Array<{
      name: string
      dflt_value: string | null
    }>
    const col = cols.find((c) => c.name === 'verify_attempt_count')
    expect(col).toBeDefined()
    expect(col?.dflt_value).toBe('0')
  })
})

describe('tasks.verify_commands column', () => {
  it('exists and is nullable', () => {
    const db = new Database(':memory:')
    createTables(db)
    const cols = db.query("PRAGMA table_info('tasks')").all() as Array<{
      name: string
      notnull: number
    }>
    const col = cols.find((c) => c.name === 'verify_commands')
    expect(col).toBeDefined()
    expect(col?.notnull).toBe(0)
  })
})

describe('tasks.pending_auto_revise_source_run_id column', () => {
  it('exists and is nullable', () => {
    const db = new Database(':memory:')
    createTables(db)
    const cols = db.query("PRAGMA table_info('tasks')").all() as Array<{
      name: string
      notnull: number
    }>
    const col = cols.find((c) => c.name === 'pending_auto_revise_source_run_id')
    expect(col).toBeDefined()
    expect(col?.notnull).toBe(0)
  })
})

describe('migration: existing DB missing the new columns', () => {
  it('adds new tasks columns via ALTER TABLE when the table already exists', () => {
    const db = new Database(':memory:')
    // Simulate a pre-Plan-C DB: create tasks table WITHOUT the new columns.
    db.run(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        board_id TEXT,
        column_id TEXT,
        title TEXT,
        body TEXT DEFAULT '',
        position REAL DEFAULT 0,
        action TEXT,
        agent_instruction TEXT,
        target_repo TEXT,
        target_branch TEXT,
        agent_status TEXT DEFAULT 'idle',
        queue_after TEXT,
        agent_output TEXT,
        agent_error TEXT,
        retry_count INTEGER DEFAULT 0,
        pr_url TEXT,
        archived INTEGER DEFAULT 0,
        archived_at TEXT,
        created_by TEXT,
        updated_by TEXT,
        created_at TEXT,
        updated_at TEXT
      );
    `)
    // Now run createTables — it should detect the missing columns and ALTER.
    createTables(db)
    const cols = db.query("PRAGMA table_info('tasks')").all() as Array<{
      name: string
    }>
    const names = cols.map((c) => c.name)
    expect(names).toContain('verify_attempt_count')
    expect(names).toContain('verify_commands')
    expect(names).toContain('pending_auto_revise_source_run_id')
  })

  it('is idempotent when run twice', () => {
    const db = new Database(':memory:')
    createTables(db)
    // Second call should not throw "duplicate column name".
    createTables(db)
  })
})
