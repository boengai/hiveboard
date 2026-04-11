import { db } from '../db'
import { isLocalRequest } from './local'
import { validateSession } from './session'

export type AuthUser = {
  id: string
  username: string
  displayName: string
  role: string
  githubId: string | null
  githubUsername: string | null
}

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

export type AuthContext = {
  user: AuthUser | null
}

function mapUserRow(row: UserRow): AuthUser {
  return {
    displayName: row.display_name,
    githubId: row.github_id,
    githubUsername: row.github_username,
    id: row.id,
    role: row.role,
    username: row.username,
  }
}

export function getAuthContext(request: Request): AuthContext {
  // Local requests auto-authenticate as queen-bee
  if (isLocalRequest(request)) {
    const queenBee = db
      .query("SELECT * FROM users WHERE username = 'queen-bee'")
      .get() as UserRow | null
    if (queenBee) {
      return { user: mapUserRow(queenBee) }
    }
  }

  // Check for Bearer token in Authorization header
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const userRow = validateSession(token)
    if (userRow) {
      return { user: mapUserRow(userRow) }
    }
  }

  return { user: null }
}

export function requireAuth(ctx: AuthContext): AuthUser {
  if (!ctx.user) {
    throw new Error('Authentication required')
  }
  return ctx.user
}

export function requireSuperAdmin(ctx: AuthContext): AuthUser {
  const user = requireAuth(ctx)
  if (user.role !== 'super-admin') {
    throw new Error('Super-admin access required')
  }
  return user
}
