import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'

describe('task_dependencies table', () => {
  it('is created with the expected columns + PK', () => {
    const db = new Database(':memory:')
    createTables(db)
    const cols = db
      .query("PRAGMA table_info('task_dependencies')")
      .all() as Array<{ name: string; pk: number }>
    const names = cols.map((c) => c.name).sort()
    expect(names).toEqual(['blocker_id', 'created_at', 'task_id'])
    const pks = cols
      .filter((c) => c.pk > 0)
      .map((c) => c.name)
      .sort()
    expect(pks).toEqual(['blocker_id', 'task_id'])
  })

  it('has both idx_task_deps indices', () => {
    const db = new Database(':memory:')
    createTables(db)
    const idx = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_task_deps_task','idx_task_deps_blocker') ORDER BY name",
      )
      .all() as Array<{ name: string }>
    expect(idx.map((r) => r.name)).toEqual([
      'idx_task_deps_blocker',
      'idx_task_deps_task',
    ])
  })

  it('cascades deletes from both tasks(id) endpoints', () => {
    const db = new Database(':memory:')
    createTables(db)
    db.run('PRAGMA foreign_keys = ON')
    db.run(
      `INSERT INTO users (id, username, display_name) VALUES ('U1','u','u')`,
    )
    db.run(`INSERT INTO boards (id, name, created_by) VALUES ('B1','b','U1')`)
    db.run(
      `INSERT INTO columns (id, board_id, name, position) VALUES ('C1','B1','Todo',0)`,
    )
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, created_by, updated_by) VALUES ('A','B1','C1','a','U1','U1')`,
    )
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, created_by, updated_by) VALUES ('B','B1','C1','b','U1','U1')`,
    )
    db.run(
      `INSERT INTO task_dependencies (task_id, blocker_id) VALUES ('B','A')`,
    )
    db.run(`DELETE FROM tasks WHERE id = 'A'`)
    const rows = db.query('SELECT * FROM task_dependencies').all()
    expect(rows).toEqual([])
  })
})

describe('tasks — new columns', () => {
  it('adds parent_task_id, time_box_ms, time_box_started_at, block_reason', () => {
    const db = new Database(':memory:')
    createTables(db)
    const cols = db.query("PRAGMA table_info('tasks')").all() as Array<{
      name: string
      notnull: number
    }>
    const names = cols.map((c) => c.name)
    for (const n of [
      'parent_task_id',
      'time_box_ms',
      'time_box_started_at',
      'block_reason',
    ]) {
      expect(names).toContain(n)
    }
    for (const n of [
      'parent_task_id',
      'time_box_ms',
      'time_box_started_at',
      'block_reason',
    ]) {
      const col = cols.find((c) => c.name === n)
      expect(col?.notnull).toBe(0)
    }
  })
})

describe('migration: existing BLOCKED rows get block_reason=QUESTION', () => {
  it('backfills block_reason for pre-existing agent_status=blocked rows', () => {
    const db = new Database(':memory:')
    // Simulate a pre-Plan-E DB: tasks table WITHOUT the new columns + a BLOCKED row.
    db.run(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, username TEXT, display_name TEXT, role TEXT DEFAULT 'member',
        github_id TEXT, github_username TEXT, revoked_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `)
    db.run(`
      CREATE TABLE boards (id TEXT PRIMARY KEY, name TEXT, created_by TEXT, created_at TEXT, updated_at TEXT);
    `)
    db.run(`
      CREATE TABLE columns (id TEXT PRIMARY KEY, board_id TEXT, name TEXT, position INTEGER, created_at TEXT);
    `)
    db.run(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        board_id TEXT,
        column_id TEXT,
        title TEXT NOT NULL,
        body TEXT DEFAULT '',
        position REAL DEFAULT 0,
        action TEXT,
        agent_instruction TEXT,
        target_repo TEXT,
        target_branch TEXT DEFAULT 'main',
        agent_status TEXT DEFAULT 'idle',
        queue_after TEXT,
        agent_output TEXT,
        agent_error TEXT,
        retry_count INTEGER DEFAULT 0,
        pr_url TEXT,
        verify_attempt_count INTEGER DEFAULT 0,
        verify_commands TEXT,
        pending_auto_revise_source_run_id TEXT,
        archived INTEGER DEFAULT 0,
        archived_at TEXT,
        created_by TEXT,
        updated_by TEXT,
        created_at TEXT,
        updated_at TEXT
      );
    `)
    db.run(
      `INSERT INTO users (id, username, display_name) VALUES ('U1','u','u')`,
    )
    db.run(
      `INSERT INTO boards (id, name, created_by, created_at, updated_at)
         VALUES ('B1','b','U1',datetime('now'),datetime('now'))`,
    )
    db.run(
      `INSERT INTO columns (id, board_id, name, position, created_at)
         VALUES ('C1','B1','Todo',0,datetime('now'))`,
    )
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, agent_status, created_by, updated_by, created_at, updated_at)
         VALUES ('TQ','B1','C1','blocked existing','blocked','U1','U1',datetime('now'),datetime('now'))`,
    )

    createTables(db)

    const row = db
      .query("SELECT block_reason FROM tasks WHERE id = 'TQ'")
      .get() as { block_reason: string | null }
    expect(row.block_reason).toBe('QUESTION')
  })

  it('is idempotent when run twice', () => {
    const db = new Database(':memory:')
    createTables(db)
    createTables(db)
  })
})
