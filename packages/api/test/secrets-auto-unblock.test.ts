import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { db } from '../src/db'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { deriveKek } from '../src/secrets/encryption'
import { _setKekForTest, _setSecretsEnabledForTest } from '../src/secrets/enabled'
import { executeGraphQL } from './helpers/gql'

const RAW = randomBytes(32).toString('base64')

function mkBlockedTask(required = '["DATABASE_URL"]'): { uid: string } {
  const uid = (db.query('SELECT id FROM users LIMIT 1').get() as { id: string }).id
  db.run(`INSERT OR REPLACE INTO boards (id, name, created_by) VALUES ('B1', 'b', ?)`, [uid])
  db.run(`INSERT OR REPLACE INTO columns (id, board_id, name, position) VALUES ('C1', 'B1', 'todo', 0)`)
  db.run(
    `INSERT OR REPLACE INTO tasks (id, board_id, column_id, title, body, position, action, agent_status, required_secrets, created_by, updated_by)
     VALUES ('T1', 'B1', 'C1', 't', '', 0, 'implement', 'missing_secrets', ?, ?, ?)`,
    [required, uid, uid],
  )
  return { uid }
}

describe('auto-unblock', () => {
  beforeEach(() => {
    createTables(db)
    seed(db)
    _setKekForTest(deriveKek(RAW))
    _setSecretsEnabledForTest(true)
  })
  afterEach(() => {
    _setKekForTest(null)
    _setSecretsEnabledForTest(undefined)
    db.run(`DELETE FROM task_secrets`)
    db.run(`DELETE FROM board_secrets`)
    db.run(`DELETE FROM tasks WHERE id = 'T1'`)
    db.run(`DELETE FROM boards WHERE id = 'B1'`)
    db.run(`DELETE FROM columns WHERE id = 'C1'`)
  })

  it('setBoardSecret transitions MISSING_SECRETS task to QUEUED with +5s grace', async () => {
    const { uid } = mkBlockedTask()
    await executeGraphQL(db, uid, {
      query: `mutation { setBoardSecret(boardId: "B1", name: "DATABASE_URL", value: "pg://x") { id } }`,
    })
    const row = db
      .query('SELECT agent_status, queue_after, agent_error FROM tasks WHERE id = ?')
      .get('T1') as { agent_status: string; queue_after: string | null; agent_error: string | null }
    expect(row.agent_status).toBe('queued')
    expect(row.agent_error).toBeNull()
    expect(row.queue_after).not.toBeNull()
    // queue_after ~5 seconds in the future (SQLite stores ISO without Z; interpret as UTC)
    const stamp = row.queue_after!.includes('T') ? row.queue_after! : row.queue_after!.replace(' ', 'T') + 'Z'
    const delta = new Date(stamp).getTime() - Date.now()
    expect(delta).toBeGreaterThan(3000)
    expect(delta).toBeLessThan(8000)
  })

  it('setBoardSecret for a different name does not transition', async () => {
    const { uid } = mkBlockedTask()
    await executeGraphQL(db, uid, {
      query: `mutation { setBoardSecret(boardId: "B1", name: "SOME_OTHER_NAME", value: "value1") { id } }`,
    })
    const row = db.query('SELECT agent_status FROM tasks WHERE id = ?').get('T1') as { agent_status: string }
    expect(row.agent_status).toBe('missing_secrets')
  })

  it('partial satisfaction does not transition', async () => {
    const { uid } = mkBlockedTask('["A","B"]')
    await executeGraphQL(db, uid, {
      query: `mutation { setBoardSecret(boardId: "B1", name: "A", value: "value1") { id } }`,
    })
    const row = db.query('SELECT agent_status FROM tasks WHERE id = ?').get('T1') as { agent_status: string }
    expect(row.agent_status).toBe('missing_secrets')
  })

  it('setTaskSecret scoped to the task transitions that task only', async () => {
    const { uid } = mkBlockedTask()
    await executeGraphQL(db, uid, {
      query: `mutation { setTaskSecret(taskId: "T1", name: "DATABASE_URL", value: "pg://x") { id } }`,
    })
    const row = db.query('SELECT agent_status FROM tasks WHERE id = ?').get('T1') as { agent_status: string }
    expect(row.agent_status).toBe('queued')
  })

  it('deleteBoardSecret does NOT transition but recomputes missing', async () => {
    const { uid } = mkBlockedTask()
    // First set, then delete.
    await executeGraphQL(db, uid, {
      query: `mutation { setBoardSecret(boardId: "B1", name: "DATABASE_URL", value: "pg://x") { id } }`,
    })
    // Task should be queued now.
    expect((db.query('SELECT agent_status FROM tasks WHERE id = ?').get('T1') as { agent_status: string }).agent_status).toBe('queued')
    // Force back to missing_secrets so we can assert delete doesn't silently transition it.
    db.run(`UPDATE tasks SET agent_status = 'missing_secrets' WHERE id = ?`, ['T1'])
    await executeGraphQL(db, uid, {
      query: `mutation { deleteBoardSecret(boardId: "B1", name: "DATABASE_URL") }`,
    })
    const row = db.query('SELECT agent_status FROM tasks WHERE id = ?').get('T1') as { agent_status: string }
    expect(row.agent_status).toBe('missing_secrets')  // still missing, delete did not auto-queue
  })
})
