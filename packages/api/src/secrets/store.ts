import type { Database } from 'bun:sqlite'
import { generateId } from '../db/ulid'
import { decrypt, encrypt } from './encryption'
import { getKek, secretsEnabled } from './enabled'

export const NAME_REGEX = /^[A-Z_][A-Z0-9_]*$/

/**
 * Parse the JSON array stored in `tasks.required_secrets`. Returns [] on
 * malformed input, non-string input, or non-array JSON.
 */
export function parseRequiredSecrets(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

export type BoardSecretRow = {
  id: string
  boardId: string
  name: string
  description: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type TaskSecretRow = {
  id: string
  taskId: string
  name: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type ResolveResult =
  | { ok: true; env: Record<string, string>; values: string[] }
  | { ok: false; missing: string[] }

function requireKek(): Buffer {
  const k = getKek()
  if (!k) throw new Error('SECRETS_DISABLED')
  return k
}

export function setBoardSecret(
  db: Database,
  input: {
    boardId: string
    name: string
    value: string
    description?: string | null
    userId: string
  },
): void {
  const kek = requireKek()
  const encrypted = encrypt(kek, input.value)
  const existing = db
    .query('SELECT id FROM board_secrets WHERE board_id = ? AND name = ?')
    .get(input.boardId, input.name) as { id: string } | null
  if (existing) {
    db.run(
      `UPDATE board_secrets
         SET encrypted_value = ?,
             description = COALESCE(?, description),
             updated_at = datetime('now')
       WHERE id = ?`,
      [encrypted, input.description ?? null, existing.id],
    )
  } else {
    db.run(
      `INSERT INTO board_secrets (id, board_id, name, encrypted_value, description, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [generateId(), input.boardId, input.name, encrypted, input.description ?? null, input.userId],
    )
  }
}

export function deleteBoardSecret(db: Database, boardId: string, name: string): void {
  db.run('DELETE FROM board_secrets WHERE board_id = ? AND name = ?', [boardId, name])
}

export function listBoardSecrets(db: Database, boardId: string): BoardSecretRow[] {
  const rows = db
    .query(
      `SELECT id, board_id, name, description, created_by, created_at, updated_at
         FROM board_secrets WHERE board_id = ? ORDER BY name ASC`,
    )
    .all(boardId) as Array<{
      id: string
      board_id: string
      name: string
      description: string | null
      created_by: string
      created_at: string
      updated_at: string
    }>
  return rows.map((r) => ({
    id: r.id,
    boardId: r.board_id,
    name: r.name,
    description: r.description,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

export function setTaskSecret(
  db: Database,
  input: { taskId: string; name: string; value: string; userId: string },
): void {
  const kek = requireKek()
  const encrypted = encrypt(kek, input.value)
  const existing = db
    .query('SELECT id FROM task_secrets WHERE task_id = ? AND name = ?')
    .get(input.taskId, input.name) as { id: string } | null
  if (existing) {
    db.run(
      `UPDATE task_secrets SET encrypted_value = ?, updated_at = datetime('now') WHERE id = ?`,
      [encrypted, existing.id],
    )
  } else {
    db.run(
      `INSERT INTO task_secrets (id, task_id, name, encrypted_value, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [generateId(), input.taskId, input.name, encrypted, input.userId],
    )
  }
}

export function deleteTaskSecret(db: Database, taskId: string, name: string): void {
  db.run('DELETE FROM task_secrets WHERE task_id = ? AND name = ?', [taskId, name])
}

export function listTaskSecrets(db: Database, taskId: string): TaskSecretRow[] {
  const rows = db
    .query(
      `SELECT id, task_id, name, created_by, created_at, updated_at
         FROM task_secrets WHERE task_id = ? ORDER BY name ASC`,
    )
    .all(taskId) as Array<{
      id: string
      task_id: string
      name: string
      created_by: string
      created_at: string
      updated_at: string
    }>
  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    name: r.name,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

type TaskRequiredRow = {
  board_id: string
  required_secrets: string
}

/**
 * Returns the subset of a task's required_secrets that are NOT satisfied by
 * either task_secrets (override) or board_secrets (default). Does NOT decrypt.
 * Safe to call from GraphQL resolvers.
 *
 * When the secrets feature is disabled, returns the full required_secrets list
 * (everything is considered missing).
 */
export function computeMissingSecretNames(
  db: Database,
  taskId: string,
): string[] {
  const taskRow = db
    .query('SELECT board_id, required_secrets FROM tasks WHERE id = ?')
    .get(taskId) as { board_id: string; required_secrets: string } | null
  if (!taskRow) return []
  const required = parseRequiredSecrets(taskRow.required_secrets)
  if (required.length === 0) return []
  if (!secretsEnabled()) return [...required]

  // Presence-only queries — no encrypted_value selected.
  const taskRows = db
    .query('SELECT name FROM task_secrets WHERE task_id = ?')
    .all(taskId) as Array<{ name: string }>
  const boardRows = db
    .query('SELECT name FROM board_secrets WHERE board_id = ?')
    .all(taskRow.board_id) as Array<{ name: string }>
  const present = new Set<string>()
  for (const r of taskRows) present.add(r.name)
  for (const r of boardRows) present.add(r.name)
  return required.filter((name) => !present.has(name))
}

/**
 * Resolve the env + plaintext-values list for a task's required_secrets.
 *
 * ONLY callers: orchestrator pre-spawn path, and the auto-unblock re-resolver.
 * NEVER call from a GraphQL resolver.
 */
export function resolveSecretsForTask(
  db: Database,
  taskId: string,
): ResolveResult {
  const taskRow = db
    .query('SELECT board_id, required_secrets FROM tasks WHERE id = ?')
    .get(taskId) as TaskRequiredRow | null
  if (!taskRow) return { ok: false, missing: [] }

  const required = parseRequiredSecrets(taskRow.required_secrets)
  if (required.length === 0) return { ok: true, env: {}, values: [] }

  if (!secretsEnabled()) return { ok: false, missing: [...required] }

  const kek = getKek()
  if (!kek) return { ok: false, missing: [...required] }

  const env: Record<string, string> = {}
  const values: string[] = []
  const missing: string[] = []
  for (const name of required) {
    const row =
      (db
        .query('SELECT encrypted_value FROM task_secrets WHERE task_id = ? AND name = ?')
        .get(taskId, name) as { encrypted_value: Buffer | Uint8Array } | null) ??
      (db
        .query('SELECT encrypted_value FROM board_secrets WHERE board_id = ? AND name = ?')
        .get(taskRow.board_id, name) as { encrypted_value: Buffer | Uint8Array } | null)
    if (!row) {
      missing.push(name)
      continue
    }
    try {
      const buf = Buffer.isBuffer(row.encrypted_value)
        ? row.encrypted_value
        : Buffer.from(row.encrypted_value)
      const pt = decrypt(kek, buf)
      env[name] = pt
      values.push(pt)
    } catch {
      missing.push(name)
    }
  }
  return missing.length ? { ok: false, missing } : { ok: true, env, values }
}
