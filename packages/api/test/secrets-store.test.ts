import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import {
  _setKekForTest,
  _setSecretsEnabledForTest,
} from '../src/secrets/enabled'
import {
  computeMissingSecretNames,
  deleteBoardSecret,
  deleteTaskSecret,
  listBoardSecrets,
  listTaskSecrets,
  NAME_REGEX,
  parseRequiredSecrets,
  resolveSecretsForTask,
  setBoardSecret,
  setTaskSecret,
} from '../src/secrets/store'
import { deriveKek } from '../src/secrets/encryption'

const RAW = randomBytes(32).toString('base64')

function mkDb(): Database {
  const db = new Database(':memory:')
  createTables(db)
  seed(db)
  db.run(`INSERT INTO boards (id, name, created_by) VALUES ('B1', 'b', (SELECT id FROM users LIMIT 1))`)
  db.run(`INSERT INTO columns (id, board_id, name, position) VALUES ('C1', 'B1', 'todo', 0)`)
  db.run(
    `INSERT INTO tasks (id, board_id, column_id, title, body, position, created_by, updated_by, required_secrets)
     VALUES ('T1', 'B1', 'C1', 't', '', 0, (SELECT id FROM users LIMIT 1), (SELECT id FROM users LIMIT 1), '["DATABASE_URL","API_KEY"]')`,
  )
  return db
}

describe('parseRequiredSecrets', () => {
  it('parses a JSON array of strings', () => {
    expect(parseRequiredSecrets('["A","B"]')).toEqual(['A', 'B'])
  })
  it('returns [] for non-array JSON', () => {
    expect(parseRequiredSecrets('"nope"')).toEqual([])
    expect(parseRequiredSecrets('42')).toEqual([])
  })
  it('returns [] for malformed JSON', () => {
    expect(parseRequiredSecrets('not-json')).toEqual([])
  })
  it('returns [] for non-string input', () => {
    expect(parseRequiredSecrets(null)).toEqual([])
    expect(parseRequiredSecrets(undefined)).toEqual([])
    expect(parseRequiredSecrets(42)).toEqual([])
  })
})

describe('secrets name regex', () => {
  it('accepts UPPER_SNAKE', () => {
    expect(NAME_REGEX.test('DATABASE_URL')).toBe(true)
    expect(NAME_REGEX.test('A')).toBe(true)
    expect(NAME_REGEX.test('_X')).toBe(true)
    expect(NAME_REGEX.test('API_V2')).toBe(true)
  })
  it('rejects invalid forms', () => {
    expect(NAME_REGEX.test('database_url')).toBe(false)
    expect(NAME_REGEX.test('API-KEY')).toBe(false)
    expect(NAME_REGEX.test('API.KEY')).toBe(false)
    expect(NAME_REGEX.test('1KEY')).toBe(false)
    expect(NAME_REGEX.test('')).toBe(false)
  })
})

describe('board secrets store', () => {
  let db: Database
  let uid: string

  beforeEach(() => {
    _setKekForTest(deriveKek(RAW))
    _setSecretsEnabledForTest(true)
    db = mkDb()
    uid = (db.query('SELECT id FROM users LIMIT 1').get() as { id: string }).id
  })
  afterEach(() => {
    _setKekForTest(null)
    _setSecretsEnabledForTest(undefined)
  })

  it('upserts and lists a board secret without exposing ciphertext or value', () => {
    setBoardSecret(db, { boardId: 'B1', name: 'DATABASE_URL', value: 'postgres://x', description: 'db', userId: uid })
    const rows = listBoardSecrets(db, 'B1')
    expect(rows).toHaveLength(1)
    const first = rows[0]!
    expect(first.name).toBe('DATABASE_URL')
    expect(first.description).toBe('db')
    expect('encrypted_value' in first).toBe(false)
    expect('value' in first).toBe(false)
  })

  it('upserting the same name updates the value (keeps id)', () => {
    setBoardSecret(db, { boardId: 'B1', name: 'DATABASE_URL', value: 'v1', userId: uid })
    const first = listBoardSecrets(db, 'B1')[0]!
    setBoardSecret(db, { boardId: 'B1', name: 'DATABASE_URL', value: 'v2', userId: uid })
    const second = listBoardSecrets(db, 'B1')[0]!
    expect(second.id).toBe(first.id)
    expect(second.updatedAt >= first.updatedAt).toBe(true)
  })

  it('deletes a board secret', () => {
    setBoardSecret(db, { boardId: 'B1', name: 'DATABASE_URL', value: 'v', userId: uid })
    deleteBoardSecret(db, 'B1', 'DATABASE_URL')
    expect(listBoardSecrets(db, 'B1')).toHaveLength(0)
  })
})

describe('task secrets store', () => {
  let db: Database
  let uid: string

  beforeEach(() => {
    _setKekForTest(deriveKek(RAW))
    _setSecretsEnabledForTest(true)
    db = mkDb()
    uid = (db.query('SELECT id FROM users LIMIT 1').get() as { id: string }).id
  })
  afterEach(() => {
    _setKekForTest(null)
    _setSecretsEnabledForTest(undefined)
  })

  it('upserts and lists a task secret without exposing ciphertext or value', () => {
    setTaskSecret(db, { taskId: 'T1', name: 'API_KEY', value: 'k', userId: uid })
    const rows = listTaskSecrets(db, 'T1')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('API_KEY')
    expect('encrypted_value' in rows[0]!).toBe(false)
    expect('value' in rows[0]!).toBe(false)
  })

  it('deletes a task secret', () => {
    setTaskSecret(db, { taskId: 'T1', name: 'API_KEY', value: 'k', userId: uid })
    deleteTaskSecret(db, 'T1', 'API_KEY')
    expect(listTaskSecrets(db, 'T1')).toHaveLength(0)
  })
})

describe('resolveSecretsForTask', () => {
  let db: Database
  let uid: string

  beforeEach(() => {
    _setKekForTest(deriveKek(RAW))
    _setSecretsEnabledForTest(true)
    db = mkDb()
    uid = (db.query('SELECT id FROM users LIMIT 1').get() as { id: string }).id
  })
  afterEach(() => {
    _setKekForTest(null)
    _setSecretsEnabledForTest(undefined)
  })

  it('returns missing when no secrets set', () => {
    const r = resolveSecretsForTask(db, 'T1')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.missing.sort()).toEqual(['API_KEY', 'DATABASE_URL'])
    }
  })

  it('returns missing for undeclared partial coverage', () => {
    setBoardSecret(db, { boardId: 'B1', name: 'DATABASE_URL', value: 'pg', userId: uid })
    const r = resolveSecretsForTask(db, 'T1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.missing).toEqual(['API_KEY'])
  })

  it('resolves all from board scope', () => {
    setBoardSecret(db, { boardId: 'B1', name: 'DATABASE_URL', value: 'pg', userId: uid })
    setBoardSecret(db, { boardId: 'B1', name: 'API_KEY', value: 'k', userId: uid })
    const r = resolveSecretsForTask(db, 'T1')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.env).toEqual({ DATABASE_URL: 'pg', API_KEY: 'k' })
      expect(r.values.sort()).toEqual(['k', 'pg'])
    }
  })

  it('task override wins over board', () => {
    setBoardSecret(db, { boardId: 'B1', name: 'DATABASE_URL', value: 'pg', userId: uid })
    setBoardSecret(db, { boardId: 'B1', name: 'API_KEY', value: 'k-board', userId: uid })
    setTaskSecret(db, { taskId: 'T1', name: 'API_KEY', value: 'k-task', userId: uid })
    const r = resolveSecretsForTask(db, 'T1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.env.API_KEY).toBe('k-task')
  })

  it('treats corrupt ciphertext as missing', () => {
    setBoardSecret(db, { boardId: 'B1', name: 'DATABASE_URL', value: 'pg', userId: uid })
    setBoardSecret(db, { boardId: 'B1', name: 'API_KEY', value: 'k', userId: uid })
    db.run(`UPDATE board_secrets SET encrypted_value = X'00' WHERE name = 'API_KEY'`)
    const r = resolveSecretsForTask(db, 'T1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.missing).toEqual(['API_KEY'])
  })

  it('returns missing = required when secrets feature disabled', () => {
    _setSecretsEnabledForTest(false)
    const r = resolveSecretsForTask(db, 'T1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.missing.sort()).toEqual(['API_KEY', 'DATABASE_URL'])
  })

  it('returns ok:true with empty env when required_secrets is empty', () => {
    db.run(`UPDATE tasks SET required_secrets = '[]' WHERE id = ?`, ['T1'])
    const r = resolveSecretsForTask(db, 'T1')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.env).toEqual({})
      expect(r.values).toEqual([])
    }
  })
})

describe('computeMissingSecretNames', () => {
  let db: Database
  let uid: string
  beforeEach(() => {
    _setKekForTest(deriveKek(RAW))
    _setSecretsEnabledForTest(true)
    db = mkDb()
    uid = (db.query('SELECT id FROM users LIMIT 1').get() as { id: string }).id
  })
  afterEach(() => {
    _setKekForTest(null)
    _setSecretsEnabledForTest(undefined)
  })

  it('returns all required names when none are set', () => {
    expect(computeMissingSecretNames(db, 'T1').sort()).toEqual(['API_KEY', 'DATABASE_URL'])
  })

  it('returns only the unsatisfied subset', () => {
    setBoardSecret(db, { boardId: 'B1', name: 'DATABASE_URL', value: 'pg', userId: uid })
    expect(computeMissingSecretNames(db, 'T1')).toEqual(['API_KEY'])
  })

  it('returns [] when all satisfied', () => {
    setBoardSecret(db, { boardId: 'B1', name: 'DATABASE_URL', value: 'pg', userId: uid })
    setTaskSecret(db, { taskId: 'T1', name: 'API_KEY', value: 'k', userId: uid })
    expect(computeMissingSecretNames(db, 'T1')).toEqual([])
  })

  it('returns all required when feature disabled (no decrypt attempted)', () => {
    setBoardSecret(db, { boardId: 'B1', name: 'DATABASE_URL', value: 'pg', userId: uid })
    setBoardSecret(db, { boardId: 'B1', name: 'API_KEY', value: 'k', userId: uid })
    _setSecretsEnabledForTest(false)
    expect(computeMissingSecretNames(db, 'T1').sort()).toEqual(['API_KEY', 'DATABASE_URL'])
  })
})
