import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { db } from '../src/db'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { deriveKek } from '../src/secrets/encryption'
import {
  _setKekForTest,
  _setSecretsEnabledForTest,
} from '../src/secrets/enabled'
import { executeGraphQL } from './helpers/gql'

const RAW = randomBytes(32).toString('base64')

function mk() {
  const uid = (db.query('SELECT id FROM users LIMIT 1').get() as { id: string }).id
  db.run(`INSERT OR REPLACE INTO boards (id, name, created_by) VALUES ('B1', 'b', ?)`, [uid])
  db.run(`INSERT OR REPLACE INTO columns (id, board_id, name, position) VALUES ('C1', 'B1', 'todo', 0)`)
  return { db, uid }
}

describe('setBoardSecret / deleteBoardSecret', () => {
  beforeEach(() => {
    createTables(db)
    seed(db)
    _setKekForTest(deriveKek(RAW))
    _setSecretsEnabledForTest(true)
  })
  afterEach(() => {
    _setKekForTest(null)
    _setSecretsEnabledForTest(undefined)
    // drop and recreate to leave a clean slate
    db.run(`DELETE FROM board_secrets`)
    db.run(`DELETE FROM boards WHERE id = 'B1'`)
    db.run(`DELETE FROM columns WHERE id = 'C1'`)
  })

  it('rejects when secrets feature is disabled', async () => {
    _setSecretsEnabledForTest(false)
    const { uid } = mk()
    const res = await executeGraphQL(db, uid, {
      query: `mutation { setBoardSecret(boardId: "B1", name: "DATABASE_URL", value: "pg", description: "db") { id name description } }`,
    })
    expect(res.errors?.[0]?.extensions?.code).toBe('SECRETS_DISABLED')
    expect(res.data).toBeFalsy()
  })

  it('rejects invalid names', async () => {
    const { uid } = mk()
    const res = await executeGraphQL(db, uid, {
      query: `mutation { setBoardSecret(boardId: "B1", name: "api-key", value: "v") { id } }`,
    })
    expect(res.errors?.[0]?.extensions?.code).toBe('SECRET_NAME_INVALID')
  })

  it('rejects empty values', async () => {
    const { uid } = mk()
    const res = await executeGraphQL(db, uid, {
      query: `mutation { setBoardSecret(boardId: "B1", name: "API_KEY", value: "") { id } }`,
    })
    expect(res.errors?.[0]?.extensions?.code).toBe('SECRET_VALUE_EMPTY')
  })

  it('rejects values shorter than 6 characters', async () => {
    const { db, uid } = mk()
    const res = await executeGraphQL(db, uid, {
      query: `mutation { setBoardSecret(boardId: "B1", name: "API_KEY", value: "abc") { id } }`,
    })
    expect(res.errors?.[0]?.extensions?.code).toBe('SECRET_VALUE_TOO_SHORT')
  })

  it('sets a board secret and lists it via Board.secrets without plaintext', async () => {
    const { uid } = mk()
    await executeGraphQL(db, uid, {
      query: `mutation { setBoardSecret(boardId: "B1", name: "DATABASE_URL", value: "pg://host/db", description: "db") { id name description } }`,
    })
    const res = await executeGraphQL(db, uid, {
      query: `query { board(id: "B1") { id secrets { id name description createdAt } } }`,
    })
    expect(res.errors).toBeFalsy()
    const json = JSON.stringify(res)
    expect(json).not.toContain('pg://host/db')
    expect(json).not.toContain('encrypted_value')
    expect(json).not.toContain('encryptedValue')
    const secrets = (res.data as any)?.board?.secrets
    expect(secrets).toHaveLength(1)
    expect(secrets[0].name).toBe('DATABASE_URL')
    expect(secrets[0].description).toBe('db')
  })

  it('deletes a board secret', async () => {
    const { uid } = mk()
    await executeGraphQL(db, uid, {
      query: `mutation { setBoardSecret(boardId: "B1", name: "DATABASE_URL", value: "pg://x") { id } }`,
    })
    const del = await executeGraphQL(db, uid, {
      query: `mutation { deleteBoardSecret(boardId: "B1", name: "DATABASE_URL") }`,
    })
    expect((del.data as any)?.deleteBoardSecret).toBe(true)
    const list = await executeGraphQL(db, uid, {
      query: `query { board(id: "B1") { secrets { name } } }`,
    })
    expect((list.data as any)?.board?.secrets).toHaveLength(0)
  })

  describe('RBAC — non-owner access', () => {
    let ownerId: string
    let otherUserId: string

    beforeEach(() => {
      // Outer beforeEach already ran createTables, seed, _setKekForTest, _setSecretsEnabledForTest(true).
      // Just set up the board and the second non-admin user.
      const base = mk()
      ownerId = base.uid
      // Create a second non-admin user and give them no access to B1.
      db.run(
        `INSERT INTO users (id, username, display_name, role) VALUES ('U_OTHER', 'other', 'Other', 'member')`,
      )
      otherUserId = 'U_OTHER'
    })
    afterEach(() => {
      db.run(`DELETE FROM users WHERE id = 'U_OTHER'`)
    })

    it('setBoardSecret as non-owner returns NOT_FOUND, not FORBIDDEN', async () => {
      const res = await executeGraphQL(db, otherUserId, {
        query: `mutation { setBoardSecret(boardId: "B1", name: "X", value: "v") { id } }`,
      })
      expect(res.errors?.[0]?.extensions?.code).toBe('NOT_FOUND')
      expect(res.data).toBeFalsy()
    })

    it('deleteBoardSecret as non-owner returns NOT_FOUND, not FORBIDDEN', async () => {
      const res = await executeGraphQL(db, otherUserId, {
        query: `mutation { deleteBoardSecret(boardId: "B1", name: "X") }`,
      })
      expect(res.errors?.[0]?.extensions?.code).toBe('NOT_FOUND')
      expect(res.data).toBeFalsy()
    })
  })
})

describe('setTaskSecret / deleteTaskSecret / setTaskRequiredSecrets', () => {
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

  function mkTask(): { uid: string } {
    const base = mk()
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, body, position, created_by, updated_by)
       VALUES ('T1', 'B1', 'C1', 't', '', 0, ?, ?)`,
      [base.uid, base.uid],
    )
    return base
  }

  it('setTaskRequiredSecrets rejects invalid names', async () => {
    const { uid } = mkTask()
    const res = await executeGraphQL(db, uid, {
      query: `mutation { setTaskRequiredSecrets(taskId: "T1", names: ["api-key"]) { id requiredSecrets } }`,
    })
    expect(res.errors?.[0]?.extensions?.code).toBe('SECRET_NAME_INVALID')
  })

  it('setTaskRequiredSecrets deduplicates + persists', async () => {
    const { uid } = mkTask()
    const res = await executeGraphQL(db, uid, {
      query: `mutation { setTaskRequiredSecrets(taskId: "T1", names: ["DATABASE_URL", "API_KEY", "DATABASE_URL"]) { requiredSecrets } }`,
    })
    const names = (res.data as any)?.setTaskRequiredSecrets?.requiredSecrets
    expect([...names].sort()).toEqual(['API_KEY', 'DATABASE_URL'])
  })

  it('setTaskSecret persists override; taskSecrets listed without plaintext', async () => {
    const { uid } = mkTask()
    await executeGraphQL(db, uid, {
      query: `mutation { setTaskSecret(taskId: "T1", name: "API_KEY", value: "override-v") { id name } }`,
    })
    const res = await executeGraphQL(db, uid, {
      query: `query { task(id: "T1") { id taskSecrets { id name createdAt } } }`,
    })
    const json = JSON.stringify(res)
    expect(json).not.toContain('override-v')
    expect(json).not.toContain('encrypted_value')
    expect((res.data as any)?.task?.taskSecrets).toHaveLength(1)
  })

  it('missingSecrets reflects required minus satisfied', async () => {
    const { uid } = mkTask()
    await executeGraphQL(db, uid, {
      query: `mutation { setTaskRequiredSecrets(taskId: "T1", names: ["DATABASE_URL", "API_KEY"]) { id } }`,
    })
    await executeGraphQL(db, uid, {
      query: `mutation { setBoardSecret(boardId: "B1", name: "DATABASE_URL", value: "pg://x") { id } }`,
    })
    const res = await executeGraphQL(db, uid, {
      query: `query { task(id: "T1") { requiredSecrets missingSecrets } }`,
    })
    const req = ((res.data as any)?.task?.requiredSecrets as string[]) ?? []
    expect([...req].sort()).toEqual(['API_KEY', 'DATABASE_URL'])
    expect((res.data as any)?.task?.missingSecrets).toEqual(['API_KEY'])
  })

  it('full query path does not leak any plaintext', async () => {
    const { uid } = mkTask()
    await executeGraphQL(db, uid, {
      query: `mutation { setTaskRequiredSecrets(taskId: "T1", names: ["API_KEY"]) { id } }`,
    })
    await executeGraphQL(db, uid, {
      query: `mutation { setBoardSecret(boardId: "B1", name: "API_KEY", value: "very-secret-ABC") { id } }`,
    })
    const res = await executeGraphQL(db, uid, {
      query: `query {
        task(id: "T1") { id requiredSecrets missingSecrets taskSecrets { id name } }
        board(id: "B1") { secrets { id name description } }
      }`,
    })
    expect(JSON.stringify(res)).not.toContain('very-secret-ABC')
  })

  it('rejects all mutations when secrets feature is disabled', async () => {
    const { uid } = mkTask()
    _setSecretsEnabledForTest(false)
    const r1 = await executeGraphQL(db, uid, {
      query: `mutation { setTaskSecret(taskId: "T1", name: "X", value: "v") { id } }`,
    })
    expect(r1.errors?.[0]?.extensions?.code).toBe('SECRETS_DISABLED')
    const r2 = await executeGraphQL(db, uid, {
      query: `mutation { deleteTaskSecret(taskId: "T1", name: "X") }`,
    })
    expect(r2.errors?.[0]?.extensions?.code).toBe('SECRETS_DISABLED')
    // setTaskRequiredSecrets MUST still work when disabled — declaring requirements
    // must be possible so tasks can transition to MISSING_SECRETS.
    const r3 = await executeGraphQL(db, uid, {
      query: `mutation { setTaskRequiredSecrets(taskId: "T1", names: ["X"]) { id requiredSecrets } }`,
    })
    expect(r3.errors).toBeFalsy()
    expect((r3.data as any)?.setTaskRequiredSecrets?.requiredSecrets).toEqual(['X'])
  })

  it('Task.missingSecrets / taskSecrets / requiredSecrets reject non-owner with NOT_FOUND', async () => {
    mkTask()
    // Add a non-admin user with no access to T1 / B1.
    db.run(
      `INSERT INTO users (id, username, display_name, role) VALUES ('U_OTHER', 'other', 'Other', 'member')`,
    )
    const res = await executeGraphQL(db, 'U_OTHER', {
      query: `query { task(id: "T1") { requiredSecrets } }`,
    })
    // Query.task enforces access — NOT_FOUND error is present, task data is null.
    // The invariant: no plaintext leakage at any level for non-owner.
    expect(res.errors?.[0]?.extensions?.code).toBe('NOT_FOUND')
    expect((res.data as any)?.task).toBeNull()
    db.run(`DELETE FROM users WHERE id = 'U_OTHER'`)
  })

  it('Subscription.taskMissingSecretsChanged is registered', async () => {
    const { uid } = mkTask()
    const res = await executeGraphQL(db, uid, {
      query: `{ __type(name: "Subscription") { fields { name } } }`,
    })
    const names = (res.data as any)?.__type?.fields?.map((f: any) => f.name)
    expect(names).toContain('taskMissingSecretsChanged')
  })
})

describe('zero-plaintext leakage (raw JSON inspection)', () => {
  const PLAINTEXTS = [
    'DB-PLAINTEXT-value-AAAA',
    'APIKEY-PLAINTEXT-BBBB',
    'OVERRIDE-PLAINTEXT-CCCC',
  ]
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

  it('no plaintext appears in any field path across Task + Board secret queries', async () => {
    const { db, uid } = mk()
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, body, position, created_by, updated_by, required_secrets)
       VALUES ('T1', 'B1', 'C1', 't', '', 0, ?, ?, '["DATABASE_URL","API_KEY"]')`,
      [uid, uid],
    )
    await executeGraphQL(db, uid, {
      query: `mutation { setBoardSecret(boardId: "B1", name: "DATABASE_URL", value: "${PLAINTEXTS[0]}", description: "db") { id } }`,
    })
    await executeGraphQL(db, uid, {
      query: `mutation { setBoardSecret(boardId: "B1", name: "API_KEY", value: "${PLAINTEXTS[1]}") { id } }`,
    })
    await executeGraphQL(db, uid, {
      query: `mutation { setTaskSecret(taskId: "T1", name: "API_KEY", value: "${PLAINTEXTS[2]}") { id } }`,
    })

    const res = await executeGraphQL(db, uid, {
      query: `query {
        task(id: "T1") {
          id title agentStatus requiredSecrets missingSecrets
          taskSecrets { id name createdAt updatedAt }
        }
        board(id: "B1") {
          id name
          secrets { id name description createdAt updatedAt }
        }
      }`,
    })
    const json = JSON.stringify(res)
    for (const pt of PLAINTEXTS) {
      expect(json.includes(pt)).toBe(false)
    }
    expect(json).not.toContain('encrypted_value')
    expect(json).not.toContain('encryptedValue')
  })

  it('introspection reports no `value` / `encryptedValue` fields on secret types', async () => {
    const { db, uid } = mk()
    const res = await executeGraphQL(db, uid, {
      query: `{
        board: __type(name: "BoardSecret") { fields { name } }
        task:  __type(name: "TaskSecret")  { fields { name } }
      }`,
    })
    const boardFields = ((res.data as any)?.board?.fields ?? []).map((f: any) => f.name)
    const taskFields = ((res.data as any)?.task?.fields ?? []).map((f: any) => f.name)
    for (const f of [...boardFields, ...taskFields]) {
      expect(f).not.toBe('value')
      expect(f).not.toBe('encryptedValue')
      expect(f).not.toBe('encrypted_value')
    }
  })

  it('introspection reports exact field set for BoardSecret', async () => {
    const { db, uid } = mk()
    const res = await executeGraphQL(db, uid, {
      query: `{ __type(name: "BoardSecret") { fields { name } } }`,
    })
    const names = ((res.data as any)?.__type?.fields ?? []).map((f: any) => f.name).sort()
    expect(names).toEqual(['createdAt', 'createdBy', 'description', 'id', 'name', 'updatedAt'])
  })

  it('introspection reports exact field set for TaskSecret', async () => {
    const { db, uid } = mk()
    const res = await executeGraphQL(db, uid, {
      query: `{ __type(name: "TaskSecret") { fields { name } } }`,
    })
    const names = ((res.data as any)?.__type?.fields ?? []).map((f: any) => f.name).sort()
    expect(names).toEqual(['createdAt', 'createdBy', 'id', 'name', 'updatedAt'])
  })

  it('mutation response for setBoardSecret does not contain the value', async () => {
    const { db, uid } = mk()
    const res = await executeGraphQL(db, uid, {
      query: `mutation { setBoardSecret(boardId: "B1", name: "X", value: "${PLAINTEXTS[0]}", description: "d") { id name description createdAt updatedAt } }`,
    })
    expect(JSON.stringify(res)).not.toContain(PLAINTEXTS[0])
  })

  it('mutation response for setTaskSecret does not contain the value', async () => {
    const { db, uid } = mk()
    db.run(
      `INSERT INTO tasks (id, board_id, column_id, title, body, position, created_by, updated_by)
       VALUES ('T1', 'B1', 'C1', 't', '', 0, ?, ?)`,
      [uid, uid],
    )
    const res = await executeGraphQL(db, uid, {
      query: `mutation { setTaskSecret(taskId: "T1", name: "X", value: "${PLAINTEXTS[1]}") { id name createdAt updatedAt } }`,
    })
    expect(JSON.stringify(res)).not.toContain(PLAINTEXTS[1])
  })
})
