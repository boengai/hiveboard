import { beforeEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createTables } from '../src/db/schema'
import { continueFailedTaskDb } from '../src/orchestrator/orchestrator'

const TASK_ID = '01HYX3KPQR000000000000000A'

function seedTask(
  db: Database,
  status: string,
  retryCount = 0,
  instruction: string | null = null,
): void {
  db.run(`INSERT OR IGNORE INTO users (id, username, display_name, role)
          VALUES ('sys', 'sys', 'System', 'member')`)
  db.run(`INSERT OR IGNORE INTO boards (id, name, created_by)
          VALUES ('b1', 'B', 'sys')`)
  db.run(`INSERT OR IGNORE INTO columns (id, board_id, name, position)
          VALUES ('c1', 'b1', 'Todo', 0)`)
  db.run(
    `INSERT INTO tasks (id, board_id, column_id, title, body, position,
       agent_status, retry_count, agent_instruction, created_by, updated_by)
     VALUES (?, 'b1', 'c1', 't', '', 0, ?, ?, ?, 'sys', 'sys')`,
    [TASK_ID, status, retryCount, instruction],
  )
}

describe('continueFailedTaskDb', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    createTables(db)
  })

  it('rejects with TASK_NOT_FAILED when task is not failed', () => {
    seedTask(db, 'running')
    expect(() => continueFailedTaskDb(db, TASK_ID)).toThrow(/TASK_NOT_FAILED/)
  })

  it('transitions failed → queued with retry_count incremented', () => {
    seedTask(db, 'failed', 2)
    continueFailedTaskDb(db, TASK_ID)
    const row = db
      .query('SELECT agent_status, retry_count FROM tasks WHERE id = ?')
      .get(TASK_ID) as { agent_status: string; retry_count: number }
    expect(row.agent_status).toBe('queued')
    expect(row.retry_count).toBe(3)
  })

  it('appends instruction to existing agent_instruction', () => {
    seedTask(db, 'failed', 0, 'be careful')
    continueFailedTaskDb(db, TASK_ID, 'also run the tests')
    const row = db
      .query('SELECT agent_instruction FROM tasks WHERE id = ?')
      .get(TASK_ID) as { agent_instruction: string | null }
    expect(row.agent_instruction).toContain('be careful')
    expect(row.agent_instruction).toContain('also run the tests')
  })

  it('sets agent_instruction when previously null', () => {
    seedTask(db, 'failed', 0, null)
    continueFailedTaskDb(db, TASK_ID, 'fresh guidance')
    const row = db
      .query('SELECT agent_instruction FROM tasks WHERE id = ?')
      .get(TASK_ID) as { agent_instruction: string | null }
    expect(row.agent_instruction).toBe('fresh guidance')
  })

  it('throws NOT_FOUND when task does not exist', () => {
    expect(() =>
      continueFailedTaskDb(db, '01HYX3KPQR000000000000000Z'),
    ).toThrow(/NOT_FOUND/)
  })
})
