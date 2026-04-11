import { db, generateId } from '../db'

const SESSION_TTL_HOURS = 24

type UserRow = {
  id: string
  username: string
  display_name: string
  role: string
  github_id: string | null
  github_username: string | null
  revoked_at: string | null
  created_at: string
}

export function createSession(userId: string): { token: string } {
  const id = generateId()
  const token = generateSecureToken()
  db.run(
    `INSERT INTO sessions (id, token, user_id, expires_at) VALUES (?, ?, ?, datetime('now', '+${SESSION_TTL_HOURS} hours'))`,
    [id, token, userId],
  )
  return { token }
}

export function validateSession(token: string): UserRow | null {
  const row = db
    .query(
      `SELECT u.* FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(token) as UserRow | null

  if (!row) return null

  // Check if user has been revoked
  if (row.revoked_at) return null

  return row
}

export function revokeSessionsForUser(userId: string): void {
  db.run('DELETE FROM sessions WHERE user_id = ?', [userId])
}

export function cleanExpiredSessions(): void {
  db.run("DELETE FROM sessions WHERE expires_at <= datetime('now')")
}

function generateSecureToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
