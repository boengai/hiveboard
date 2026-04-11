import { db, generateId } from '../db'

const INVITATION_EXPIRY_DAYS = 7

type InvitationRow = {
  id: string
  token: string
  github_username: string
  created_by: string
  created_at: string
  expires_at: string
  used_at: string | null
  used_by_github_id: string | null
}

export function createInvitation(
  githubUsername: string,
  createdBy: string,
): { token: string; expiresAt: string } {
  // Prevent generating invitation for existing non-revoked user
  const existingUser = db
    .query(
      "SELECT id FROM users WHERE github_username = ? AND revoked_at IS NULL AND username != 'queen-bee'",
    )
    .get(githubUsername) as { id: string } | null
  if (existingUser) {
    throw new Error(
      `User @${githubUsername} already has an active account. Revoke their access first to generate a new invitation.`,
    )
  }

  const id = generateId()
  const token = generateInvitationToken()
  db.run(
    `INSERT INTO invitations (id, token, github_username, created_by, expires_at)
     VALUES (?, ?, ?, ?, datetime('now', '+${INVITATION_EXPIRY_DAYS} days'))`,
    [id, token, githubUsername, createdBy],
  )

  const row = db
    .query('SELECT expires_at FROM invitations WHERE id = ?')
    .get(id) as { expires_at: string }

  return { expiresAt: row.expires_at, token }
}

export function validateInvitation(token: string): InvitationRow | null {
  const row = db
    .query(
      "SELECT * FROM invitations WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')",
    )
    .get(token) as InvitationRow | null
  return row
}

export function consumeInvitation(token: string, githubId: string): void {
  db.run(
    "UPDATE invitations SET used_at = datetime('now'), used_by_github_id = ? WHERE token = ?",
    [githubId, token],
  )
}

export function listInvitations(): InvitationRow[] {
  return db
    .query('SELECT * FROM invitations ORDER BY created_at DESC')
    .all() as InvitationRow[]
}

function generateInvitationToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
