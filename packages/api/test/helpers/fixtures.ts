import type { Database } from 'bun:sqlite'
import { generateId } from '../../src/db/ulid'

export type UserRow = {
  id: string
  username: string
  display_name: string
  role: string
  github_id: string | null
  github_username: string | null
}

export type BoardRow = {
  id: string
  name: string
  created_by: string
}

export type ColumnRow = {
  id: string
  board_id: string
  name: string
  position: number
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

export function getBoard(db: Database): BoardRow {
  return db.query('SELECT * FROM boards LIMIT 1').get() as BoardRow
}

export function getColumn(
  db: Database,
  boardId: string,
  position = 0,
): ColumnRow {
  return db
    .query(
      'SELECT * FROM columns WHERE board_id = ? ORDER BY position ASC LIMIT 1 OFFSET ?',
    )
    .get(boardId, position) as ColumnRow
}

export type InsertTaskOpts = {
  boardId: string
  columnId: string
  title?: string
  body?: string
  action?: string | null
  position?: number
  agentStatus?: 'idle' | 'queued' | 'running' | 'blocked'
}

export function insertTask(db: Database, opts: InsertTaskOpts): string {
  const user = getCurrentUser(db)
  const id = generateId()
  db.run(
    `INSERT INTO tasks (id, board_id, column_id, title, body, position, action, agent_status, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.boardId,
      opts.columnId,
      opts.title ?? 'Test Task',
      opts.body ?? '',
      opts.position ?? 0,
      opts.action ?? null,
      opts.agentStatus ?? 'idle',
      user.id,
      user.id,
    ],
  )
  return id
}

export function makeGitHubStub(opts: { tokenDir?: string } = {}) {
  return {
    fetchReviewComments: async () => [],
    findPrByHead: async () => null,
    getAccessToken: async () => 'fake-token',
    getIdentity: async () => ({ email: 'test@test.com', name: 'test[bot]' }),
    getTokenDir: () => opts.tokenDir ?? '/tmp/hiveboard-tokens-test',
  }
}

export function makeWorkspaceStub(opts: { path?: string } = {}) {
  return {
    createForTask: async () => ({
      created: true,
      path: opts.path ?? '/tmp/fake-workspace',
    }),
    sweepExpired: async () => {},
    ttlMs: 0,
  }
}

export async function flushMicrotasks(ms = 50): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export type ConfigOverrides = {
  maxAgents?: number
  maxRetryBackoffMs?: number
  allowedTools?: string[]
  workspaceRoot?: string
  verify?: {
    commands?: unknown[]
    enabled?: boolean
    max_auto_revises?: number
  }
}

export function makeConfig(stateRoot: string, overrides: ConfigOverrides = {}) {
  return {
    agent: {
      max_concurrent_agents: overrides.maxAgents ?? 5,
      max_retry_backoff_ms: overrides.maxRetryBackoffMs ?? 300_000,
      state_root: stateRoot,
    },
    claude: {
      allowed_tools: overrides.allowedTools ?? [],
      command: 'claude',
      max_turns: 5,
      model: undefined,
      permission_mode: undefined,
    },
    hooks: { timeout_ms: 5_000 },
    polling: { interval_ms: 60_000 },
    scheduler: { legacy_mode: false },
    verify: {
      commands: overrides.verify?.commands ?? [],
      enabled: overrides.verify?.enabled ?? false,
      max_auto_revises: overrides.verify?.max_auto_revises ?? 1,
    },
    workspace: {
      root: overrides.workspaceRoot ?? '/tmp/hiveboard-test-workspaces',
      ttl_ms: 0,
    },
  }
}
