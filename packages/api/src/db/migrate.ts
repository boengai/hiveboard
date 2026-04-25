import type { Database } from 'bun:sqlite'
import { createTables } from './schema'
import { seed } from './seed'

function renameColumn(
  db: Database,
  table: string,
  oldName: string,
  newName: string,
): void {
  const cols = db.query(`PRAGMA table_info('${table}')`).all() as Array<{
    name: string
  }>
  if (
    cols.some((c) => c.name === oldName) &&
    !cols.some((c) => c.name === newName)
  ) {
    db.exec(`ALTER TABLE ${table} RENAME COLUMN ${oldName} TO ${newName}`)
  }
}

function ensureColumn(
  db: Database,
  table: string,
  column: string,
  definition: string,
): boolean {
  const cols = db.query(`PRAGMA table_info('${table}')`).all() as Array<{
    name: string
  }>
  if (cols.some((c) => c.name === column)) return false
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  return true
}

function addMissingColumns(db: Database): void {
  const user = db
    .query("SELECT id FROM users WHERE username = 'queen-bee' LIMIT 1")
    .get() as { id: string } | null

  // boards.created_by
  if (
    ensureColumn(db, 'boards', 'created_by', 'TEXT REFERENCES users(id)') &&
    user
  ) {
    db.run('UPDATE boards SET created_by = ? WHERE created_by IS NULL', [
      user.id,
    ])
  }

  // tasks — columns added after initial schema
  ensureColumn(db, 'tasks', 'agent_output', 'TEXT')
  ensureColumn(db, 'tasks', 'agent_error', 'TEXT')
  ensureColumn(db, 'tasks', 'retry_count', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'tasks', 'pr_url', 'TEXT')
  ensureColumn(db, 'tasks', 'queue_after', 'TEXT')
  ensureColumn(db, 'tasks', 'agent_instruction', 'TEXT')

  // task_events: actor_id → actor, payload → data
  renameColumn(db, 'task_events', 'actor_id', 'actor')
  renameColumn(db, 'task_events', 'payload', 'data')

  // task_comments: author_id → created_by
  renameColumn(db, 'task_comments', 'author_id', 'created_by')

  // users: add github fields and revoked_at for auth
  ensureColumn(db, 'users', 'github_id', 'TEXT')
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id)',
  )
  ensureColumn(db, 'users', 'github_username', 'TEXT')
  ensureColumn(db, 'users', 'revoked_at', 'TEXT')

  // Upgrade queen-bee role from 'admin' to 'super-admin'
  db.run(
    "UPDATE users SET role = 'super-admin' WHERE username = 'queen-bee' AND role = 'admin'",
  )
}

// Older playbook seed defaults stored verify_commands as ["test","tsc"]
// (string aliases), but the GraphQL schema and current write path expect
// [{label, run, timeoutMs?}]. Reading a legacy row crashes the task drawer
// because VerifyCommand.label is non-nullable. Normalize legacy rows here:
// keep entries that already have label+run strings, drop malformed ones, and
// NULL the column when nothing valid remains so the field falls back to
// project defaults.
function normalizeLegacyVerifyCommands(db: Database): void {
  const rows = db
    .query(
      'SELECT id, verify_commands FROM tasks WHERE verify_commands IS NOT NULL',
    )
    .all() as Array<{ id: string; verify_commands: string }>

  for (const row of rows) {
    let parsed: unknown
    try {
      parsed = JSON.parse(row.verify_commands)
    } catch {
      db.run('UPDATE tasks SET verify_commands = NULL WHERE id = ?', [row.id])
      continue
    }

    if (!Array.isArray(parsed)) {
      db.run('UPDATE tasks SET verify_commands = NULL WHERE id = ?', [row.id])
      continue
    }

    const valid = parsed.filter(
      (e): e is { label: string; run: string } =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as { label?: unknown }).label === 'string' &&
        typeof (e as { run?: unknown }).run === 'string',
    )

    if (valid.length === parsed.length) continue

    if (valid.length === 0) {
      db.run('UPDATE tasks SET verify_commands = NULL WHERE id = ?', [row.id])
    } else {
      db.run('UPDATE tasks SET verify_commands = ? WHERE id = ?', [
        JSON.stringify(valid),
        row.id,
      ])
    }
  }
}

export function migrate(db: Database): void {
  createTables(db)
  seed(db)
  addMissingColumns(db)
  normalizeLegacyVerifyCommands(db)
}
