import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { createTables } from '../src/db/schema'

describe('task_messages table', () => {
  it('is created with the expected columns', () => {
    const db = new Database(':memory:')
    createTables(db)
    const cols = db.query("PRAGMA table_info('task_messages')").all() as Array<{
      name: string
      notnull: number
    }>
    const names = cols.map((c) => c.name).sort()
    expect(names).toEqual([
      'author_type',
      'body',
      'created_at',
      'created_by',
      'delivered_at',
      'id',
      'kind',
      'task_id',
    ])
  })

  it('enforces kind check constraint', () => {
    const db = new Database(':memory:')
    createTables(db)
    expect(() =>
      db.run(
        `INSERT INTO task_messages (id, task_id, author_type, kind, body)
         VALUES ('01HYX', '01HYX', 'human', 'invalid_kind', 'x')`,
      ),
    ).toThrow()
  })

  it('enforces author_type check constraint', () => {
    const db = new Database(':memory:')
    createTables(db)
    expect(() =>
      db.run(
        `INSERT INTO task_messages (id, task_id, author_type, kind, body)
         VALUES ('01HYX', '01HYX', 'bot', 'hint', 'x')`,
      ),
    ).toThrow()
  })
})
