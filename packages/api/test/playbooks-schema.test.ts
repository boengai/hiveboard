import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'

describe('playbooks table', () => {
  it('is created with the expected columns', () => {
    const db = new Database(':memory:')
    createTables(db)
    const cols = db
      .query("PRAGMA table_info('playbooks')")
      .all() as Array<{ name: string; notnull: number }>
    const names = cols.map((c) => c.name).sort()
    expect(names).toEqual([
      'archived',
      'created_at',
      'current_version_id',
      'description',
      'display_name',
      'id',
      'name',
    ])
  })

  it('enforces UNIQUE on name', () => {
    const db = new Database(':memory:')
    createTables(db)
    db.run(
      `INSERT INTO playbooks (id, name, display_name, description) VALUES ('P1','bump-dep','Bump','d')`,
    )
    expect(() =>
      db.run(
        `INSERT INTO playbooks (id, name, display_name, description) VALUES ('P2','bump-dep','Bump2','d2')`,
      ),
    ).toThrow(/UNIQUE/)
  })
})

describe('playbook_versions table', () => {
  it('is created with the expected columns', () => {
    const db = new Database(':memory:')
    createTables(db)
    const cols = db
      .query("PRAGMA table_info('playbook_versions')")
      .all() as Array<{ name: string }>
    const names = cols.map((c) => c.name).sort()
    expect(names).toEqual([
      'allowed_tools_override',
      'created_at',
      'created_by',
      'defaults_json',
      'id',
      'playbook_id',
      'prompt_template',
      'version_number',
    ])
  })

  it('enforces UNIQUE (playbook_id, version_number)', () => {
    const db = new Database(':memory:')
    createTables(db)
    db.run(
      `INSERT INTO users (id, username, display_name) VALUES ('U1','u','u')`,
    )
    db.run(
      `INSERT INTO playbooks (id, name, display_name, description) VALUES ('P1','bump-dep','Bump','d')`,
    )
    db.run(
      `INSERT INTO playbook_versions (id, playbook_id, version_number, prompt_template, defaults_json, created_by) VALUES ('V1','P1',1,'tpl','{}','U1')`,
    )
    expect(() =>
      db.run(
        `INSERT INTO playbook_versions (id, playbook_id, version_number, prompt_template, defaults_json, created_by) VALUES ('V2','P1',1,'tpl','{}','U1')`,
      ),
    ).toThrow(/UNIQUE/)
  })

  it('cascades deletes from playbook', () => {
    const db = new Database(':memory:')
    createTables(db)
    db.run('PRAGMA foreign_keys = ON')
    db.run(
      `INSERT INTO users (id, username, display_name) VALUES ('U1','u','u')`,
    )
    db.run(
      `INSERT INTO playbooks (id, name, display_name, description) VALUES ('P1','bump-dep','Bump','d')`,
    )
    db.run(
      `INSERT INTO playbook_versions (id, playbook_id, version_number, prompt_template, defaults_json, created_by) VALUES ('V1','P1',1,'tpl','{}','U1')`,
    )
    db.run(`DELETE FROM playbooks WHERE id = 'P1'`)
    const rows = db.query('SELECT * FROM playbook_versions').all()
    expect(rows).toEqual([])
  })

  it('has idx_playbook_versions_playbook index', () => {
    const db = new Database(':memory:')
    createTables(db)
    const idx = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_playbook_versions_playbook'",
      )
      .get() as { name: string } | null
    expect(idx?.name).toBe('idx_playbook_versions_playbook')
  })
})

describe('agent_runs.playbook_version_id column', () => {
  it('is added as a nullable TEXT column', () => {
    const db = new Database(':memory:')
    createTables(db)
    const cols = db
      .query("PRAGMA table_info('agent_runs')")
      .all() as Array<{ name: string; type: string; notnull: number }>
    const col = cols.find((c) => c.name === 'playbook_version_id')
    expect(col).toBeDefined()
    expect(col?.type).toBe('TEXT')
    expect(col?.notnull).toBe(0)
  })

  it('is idempotent on repeated createTables calls', () => {
    const db = new Database(':memory:')
    createTables(db)
    createTables(db) // must not throw
  })
})
