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
  ensureColumn(db, 'tasks', 'pr_number', 'INTEGER')
  ensureColumn(db, 'tasks', 'queue_after', 'TEXT')

  // task_events: actor_id → actor, payload → data
  renameColumn(db, 'task_events', 'actor_id', 'actor')
  renameColumn(db, 'task_events', 'payload', 'data')

  // task_comments: author_id → created_by
  renameColumn(db, 'task_comments', 'author_id', 'created_by')
}

export function migrate(db: Database): void {
  createTables(db)
  seed(db)
  addMissingColumns(db)
}
