import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'
import { createTables } from '../src/db/schema'
import { seed } from '../src/db/seed'
import { generateId } from '../src/db/ulid'

type UserRow = {
  id: string
  username: string
  display_name: string
  role: string
  github_id: string | null
  github_username: string | null
  revoked_at: string | null
}

type InvitationRow = {
  id: string
  token: string
  github_username: string
  created_by: string
  expires_at: string
  used_at: string | null
}

type SessionRow = {
  id: string
  token: string
  user_id: string
  expires_at: string
}

let db: Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  createTables(db)
  seed(db)
})

describe('auth schema', () => {
  test('users table has github fields and revoked_at', () => {
    const cols = db.query("PRAGMA table_info('users')").all() as Array<{
      name: string
    }>
    const colNames = cols.map((c) => c.name)
    expect(colNames).toContain('github_id')
    expect(colNames).toContain('github_username')
    expect(colNames).toContain('revoked_at')
  })

  test('invitations table exists with correct columns', () => {
    const cols = db.query("PRAGMA table_info('invitations')").all() as Array<{
      name: string
    }>
    const colNames = cols.map((c) => c.name)
    expect(colNames).toContain('id')
    expect(colNames).toContain('token')
    expect(colNames).toContain('github_username')
    expect(colNames).toContain('created_by')
    expect(colNames).toContain('expires_at')
    expect(colNames).toContain('used_at')
    expect(colNames).toContain('used_by_github_id')
  })

  test('sessions table exists with correct columns', () => {
    const cols = db.query("PRAGMA table_info('sessions')").all() as Array<{
      name: string
    }>
    const colNames = cols.map((c) => c.name)
    expect(colNames).toContain('id')
    expect(colNames).toContain('token')
    expect(colNames).toContain('user_id')
    expect(colNames).toContain('expires_at')
  })

  test('queen-bee is created with super-admin role', () => {
    const user = db
      .query('SELECT * FROM users WHERE username = ?')
      .get('queen-bee') as UserRow
    expect(user.role).toBe('super-admin')
    expect(user.display_name).toBe('Queen Bee')
  })
})

describe('invitations', () => {
  test('can create and query invitations', () => {
    const user = db
      .query('SELECT id FROM users WHERE username = ?')
      .get('queen-bee') as { id: string }
    const id = generateId()
    const token = 'test-invitation-token'

    db.run(
      "INSERT INTO invitations (id, token, github_username, created_by, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+7 days'))",
      [id, token, 'testuser', user.id],
    )

    const invitation = db
      .query('SELECT * FROM invitations WHERE token = ?')
      .get(token) as InvitationRow
    expect(invitation.github_username).toBe('testuser')
    expect(invitation.created_by).toBe(user.id)
    expect(invitation.used_at).toBeNull()
  })

  test('invitation token must be unique', () => {
    const user = db
      .query('SELECT id FROM users WHERE username = ?')
      .get('queen-bee') as { id: string }
    const token = 'unique-token'

    db.run(
      "INSERT INTO invitations (id, token, github_username, created_by, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+7 days'))",
      [generateId(), token, 'user1', user.id],
    )

    expect(() => {
      db.run(
        "INSERT INTO invitations (id, token, github_username, created_by, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+7 days'))",
        [generateId(), token, 'user2', user.id],
      )
    }).toThrow()
  })
})

describe('sessions', () => {
  test('can create and query sessions', () => {
    const user = db
      .query('SELECT id FROM users WHERE username = ?')
      .get('queen-bee') as { id: string }
    const id = generateId()
    const token = 'test-session-token'

    db.run(
      "INSERT INTO sessions (id, token, user_id, expires_at) VALUES (?, ?, ?, datetime('now', '+24 hours'))",
      [id, token, user.id],
    )

    const session = db
      .query('SELECT * FROM sessions WHERE token = ?')
      .get(token) as SessionRow
    expect(session.user_id).toBe(user.id)
  })

  test('session token must be unique', () => {
    const user = db
      .query('SELECT id FROM users WHERE username = ?')
      .get('queen-bee') as { id: string }
    const token = 'unique-session-token'

    db.run(
      "INSERT INTO sessions (id, token, user_id, expires_at) VALUES (?, ?, ?, datetime('now', '+24 hours'))",
      [generateId(), token, user.id],
    )

    expect(() => {
      db.run(
        "INSERT INTO sessions (id, token, user_id, expires_at) VALUES (?, ?, ?, datetime('now', '+24 hours'))",
        [generateId(), token, user.id],
      )
    }).toThrow()
  })
})

describe('user revocation', () => {
  test('can revoke a user by setting revoked_at', () => {
    const userId = generateId()
    db.run(
      "INSERT INTO users (id, username, display_name, role, github_id, github_username) VALUES (?, ?, ?, 'normal', ?, ?)",
      [userId, 'testuser', 'Test User', '12345', 'testuser'],
    )

    db.run("UPDATE users SET revoked_at = datetime('now') WHERE id = ?", [
      userId,
    ])

    const user = db
      .query('SELECT * FROM users WHERE id = ?')
      .get(userId) as UserRow
    expect(user.revoked_at).not.toBeNull()
  })

  test('revoked user data is preserved (soft delete)', () => {
    const userId = generateId()
    db.run(
      "INSERT INTO users (id, username, display_name, role, github_id, github_username) VALUES (?, ?, ?, 'normal', ?, ?)",
      [userId, 'preserved-user', 'Preserved User', '99999', 'preserved-user'],
    )

    db.run("UPDATE users SET revoked_at = datetime('now') WHERE id = ?", [
      userId,
    ])

    const user = db
      .query('SELECT * FROM users WHERE id = ?')
      .get(userId) as UserRow
    expect(user.username).toBe('preserved-user')
    expect(user.display_name).toBe('Preserved User')
    expect(user.revoked_at).not.toBeNull()
  })
})

describe('roles and permissions', () => {
  test('queen-bee has super-admin role', () => {
    const user = db
      .query('SELECT role FROM users WHERE username = ?')
      .get('queen-bee') as { role: string }
    expect(user.role).toBe('super-admin')
  })

  test('new users get normal role by default', () => {
    const userId = generateId()
    db.run(
      "INSERT INTO users (id, username, display_name, role, github_id, github_username) VALUES (?, ?, ?, 'normal', ?, ?)",
      [userId, 'newuser', 'New User', '11111', 'newuser'],
    )

    const user = db
      .query('SELECT role FROM users WHERE id = ?')
      .get(userId) as { role: string }
    expect(user.role).toBe('normal')
  })
})
