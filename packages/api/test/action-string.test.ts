import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'
import { typeDefs } from '../src/schema/typeDefs'

describe('GraphQL action field type', () => {
  it('typeDefs does not declare a BoardAction enum', () => {
    expect(typeDefs).not.toMatch(/enum\s+BoardAction/)
  })

  it('Task.action is declared as String (nullable)', () => {
    expect(typeDefs).toMatch(/\baction:\s*String\b/)
  })

  it('runAgent arg action is declared as String!', () => {
    expect(typeDefs).toMatch(/runAgent\([^)]*action:\s*String!/s)
  })
})

describe('mapTask emits raw lowercase/string action', () => {
  it('passes action through verbatim (no uppercasing)', async () => {
    const db = new Database(':memory:')
    createTables(db)
    db.run(
      `INSERT INTO users (id, username, display_name) VALUES ('U1','u','u')`,
    )
    db.run(
      `INSERT INTO boards (id, name, created_by) VALUES ('B1','b','U1')`,
    )
    db.run(
      `INSERT INTO columns (id, board_id, name, position) VALUES ('C1','B1','c',0)`,
    )
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, action, created_by, updated_by) VALUES ('T1','B1','C1','t','playbook:bump-dep','U1','U1')`,
    )

    // mapTaskForTest re-exports the module-private mapTask for verification.
    const { mapTaskForTest } = await import('../src/schema/resolvers')
    const row = db.query('SELECT * FROM tasks WHERE id = ?').get('T1') as {
      [k: string]: unknown
    }
    const task = mapTaskForTest(row)
    expect(task.action).toBe('playbook:bump-dep')
  })
})
