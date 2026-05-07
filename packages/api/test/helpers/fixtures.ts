import type { Database } from 'bun:sqlite'

export type UserRow = {
  id: string
  username: string
  display_name: string
  role: string
  github_id: string | null
  github_username: string | null
}

export function getCurrentUser(db: Database): UserRow {
  return db
    .query('SELECT * FROM users WHERE username = ?')
    .get('queen-bee') as UserRow
}

export function makeCtx(db: Database): unknown {
  const user = getCurrentUser(db)
  return {
    user: {
      displayName: 'Queen Bee',
      githubId: null,
      githubUsername: null,
      id: user.id,
      role: 'super-admin',
      username: 'queen-bee',
    },
  } as never
}
