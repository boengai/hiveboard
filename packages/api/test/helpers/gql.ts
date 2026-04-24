/**
 * Minimal GraphQL test harness.
 *
 * executeGraphQL uses the real schema + resolvers (which operate against the
 * module-level db singleton). The `userId` is looked up in the module-level db
 * to build the auth context; callers must seed the module-level db (via
 * createTables + seed) before calling this helper.
 */

import { createSchema, createYoga } from 'graphql-yoga'
import { db } from '../../src/db'
import { resolvers } from '../../src/schema/resolvers'
import { typeDefs } from '../../src/schema/typeDefs'

type UserRow = {
  id: string
  username: string
  display_name: string
  role: string
  github_id: string | null
  github_username: string | null
}

export async function executeGraphQL(
  _db: unknown,
  userId: string,
  body: { query: string; variables?: Record<string, unknown> },
): Promise<{ data: unknown; errors?: Array<{ message: string; extensions?: Record<string, unknown> }> }> {
  const row = db
    .query('SELECT * FROM users WHERE id = ?')
    .get(userId) as UserRow | null

  const user = row
    ? {
        displayName: row.display_name,
        githubId: row.github_id,
        githubUsername: row.github_username,
        id: row.id,
        role: row.role,
        username: row.username,
      }
    : null

  const yoga = createYoga({
    context: { user },
    schema: createSchema({ resolvers, typeDefs }),
  })

  const res = await yoga.fetch('http://localhost/graphql', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  return res.json() as Promise<{
    data: unknown
    errors?: Array<{ message: string; extensions?: Record<string, unknown> }>
  }>
}
