import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'

type PB = {
  id: string
  name: string
  display_name: string
  description: string
  current_version_id: string | null
  archived: number
}

type PV = {
  id: string
  playbook_id: string
  version_number: number
  prompt_template: string
  defaults_json: string
  allowed_tools_override: string | null
}

describe('seeded playbooks', () => {
  it('inserts four playbooks on a fresh DB', () => {
    const db = new Database(':memory:')
    createTables(db)
    seed(db)
    const rows = db
      .query('SELECT name FROM playbooks ORDER BY name')
      .all() as Array<{ name: string }>
    expect(rows.map((r) => r.name)).toEqual([
      'add-tests',
      'bump-dep',
      'security-review',
      'triage-flake',
    ])
  })

  it('inserts v1 for each seeded playbook and wires current_version_id', () => {
    const db = new Database(':memory:')
    createTables(db)
    seed(db)
    const pbs = db
      .query('SELECT * FROM playbooks ORDER BY name')
      .all() as PB[]
    for (const pb of pbs) {
      expect(pb.current_version_id).not.toBeNull()
      const v = db
        .query('SELECT * FROM playbook_versions WHERE id = ?')
        .get(pb.current_version_id) as PV
      expect(v.version_number).toBe(1)
      expect(v.playbook_id).toBe(pb.id)
      expect(v.prompt_template.length).toBeGreaterThan(0)
    }
  })

  it('security-review seeds allowed_tools_override = [Bash,Read,Grep,Glob]', () => {
    const db = new Database(':memory:')
    createTables(db)
    seed(db)
    const pb = db
      .query('SELECT current_version_id FROM playbooks WHERE name = ?')
      .get('security-review') as { current_version_id: string }
    const v = db
      .query(
        'SELECT allowed_tools_override FROM playbook_versions WHERE id = ?',
      )
      .get(pb.current_version_id) as { allowed_tools_override: string }
    expect(JSON.parse(v.allowed_tools_override)).toEqual([
      'Bash',
      'Read',
      'Grep',
      'Glob',
    ])
  })

  it('is idempotent — running seed twice does not duplicate playbooks', () => {
    const db = new Database(':memory:')
    createTables(db)
    seed(db)
    seed(db)
    const rows = db.query('SELECT COUNT(*) as n FROM playbooks').get() as {
      n: number
    }
    expect(rows.n).toBe(4)
  })

  it('is idempotent — running seed twice does not duplicate versions', () => {
    const db = new Database(':memory:')
    createTables(db)
    seed(db)
    seed(db)
    const rows = db
      .query('SELECT COUNT(*) as n FROM playbook_versions')
      .get() as { n: number }
    expect(rows.n).toBe(4)
  })
})
