import type { Database } from 'bun:sqlite'
import { generateId } from '../db/ulid'

export type PlaybookVersion = {
  id: string
  playbookId: string
  versionNumber: number
  promptTemplate: string
  defaultsJson: string
  allowedToolsOverride: string[] | null
  createdBy: string
  createdAt: string
}

export type Playbook = {
  id: string
  name: string
  displayName: string
  description: string
  currentVersion: PlaybookVersion
  archived: boolean
  createdAt: string
}

export class PlaybookNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Playbook not found: ${identifier}`)
    this.name = 'PlaybookNotFoundError'
  }
}

export class PlaybookArchivedError extends Error {
  constructor(name: string) {
    super(`Playbook is archived: ${name}`)
    this.name = 'PlaybookArchivedError'
  }
}

export class PlaybookNameTakenError extends Error {
  constructor(name: string) {
    super(`Playbook name is already taken: ${name}`)
    this.name = 'PlaybookNameTakenError'
  }
}

type PlaybookRow = {
  id: string
  name: string
  display_name: string
  description: string
  current_version_id: string | null
  created_at: string
  archived: number
}

type PlaybookVersionRow = {
  id: string
  playbook_id: string
  version_number: number
  prompt_template: string
  defaults_json: string
  allowed_tools_override: string | null
  created_by: string
  created_at: string
}

function rowToVersion(row: PlaybookVersionRow): PlaybookVersion {
  return {
    allowedToolsOverride: row.allowed_tools_override
      ? (JSON.parse(row.allowed_tools_override) as string[])
      : null,
    createdAt: row.created_at,
    createdBy: row.created_by,
    defaultsJson: row.defaults_json,
    id: row.id,
    playbookId: row.playbook_id,
    promptTemplate: row.prompt_template,
    versionNumber: row.version_number,
  }
}

function fetchCurrent(db: Database, row: PlaybookRow): Playbook {
  if (!row.current_version_id) {
    throw new Error(
      `Playbook ${row.id} has no current_version_id — DB invariant violated`,
    )
  }
  const v = db
    .query('SELECT * FROM playbook_versions WHERE id = ?')
    .get(row.current_version_id) as PlaybookVersionRow | null
  if (!v) {
    // Fallback per spec: pick newest version for this playbook
    const newest = db
      .query(
        'SELECT * FROM playbook_versions WHERE playbook_id = ? ORDER BY version_number DESC LIMIT 1',
      )
      .get(row.id) as PlaybookVersionRow | null
    if (!newest) throw new Error(`Playbook ${row.id} has no versions`)
    return {
      archived: Boolean(row.archived),
      createdAt: row.created_at,
      currentVersion: rowToVersion(newest),
      description: row.description,
      displayName: row.display_name,
      id: row.id,
      name: row.name,
    }
  }
  return {
    archived: Boolean(row.archived),
    createdAt: row.created_at,
    currentVersion: rowToVersion(v),
    description: row.description,
    displayName: row.display_name,
    id: row.id,
    name: row.name,
  }
}

export function listPlaybooks(db: Database): Playbook[] {
  const rows = db
    .query('SELECT * FROM playbooks ORDER BY name ASC')
    .all() as PlaybookRow[]
  return rows.map((r) => fetchCurrent(db, r))
}

export function getPlaybookByName(
  db: Database,
  name: string,
): Playbook | null {
  const row = db
    .query('SELECT * FROM playbooks WHERE name = ?')
    .get(name) as PlaybookRow | null
  return row ? fetchCurrent(db, row) : null
}

export function getPlaybookById(db: Database, id: string): Playbook | null {
  const row = db
    .query('SELECT * FROM playbooks WHERE id = ?')
    .get(id) as PlaybookRow | null
  return row ? fetchCurrent(db, row) : null
}

export function listPlaybookVersions(
  db: Database,
  playbookId: string,
): PlaybookVersion[] {
  const rows = db
    .query(
      'SELECT * FROM playbook_versions WHERE playbook_id = ? ORDER BY version_number DESC',
    )
    .all(playbookId) as PlaybookVersionRow[]
  return rows.map(rowToVersion)
}

export function getPlaybookVersionById(
  db: Database,
  versionId: string,
): PlaybookVersion | null {
  const row = db
    .query('SELECT * FROM playbook_versions WHERE id = ?')
    .get(versionId) as PlaybookVersionRow | null
  return row ? rowToVersion(row) : null
}

export type CreatePlaybookInput = {
  name: string
  displayName: string
  description: string
  promptTemplate: string
  defaultsJson: string
  allowedToolsOverride: string[] | null
  createdBy: string
}

export function createPlaybook(
  db: Database,
  input: CreatePlaybookInput,
): Playbook {
  const playbookId = generateId()
  const versionId = generateId()

  try {
    db.exec('BEGIN')
    db.run(
      `INSERT INTO playbooks (id, name, display_name, description) VALUES (?, ?, ?, ?)`,
      [playbookId, input.name, input.displayName, input.description],
    )
    db.run(
      `INSERT INTO playbook_versions
         (id, playbook_id, version_number, prompt_template, defaults_json, allowed_tools_override, created_by)
       VALUES (?, ?, 1, ?, ?, ?, ?)`,
      [
        versionId,
        playbookId,
        input.promptTemplate,
        input.defaultsJson,
        input.allowedToolsOverride
          ? JSON.stringify(input.allowedToolsOverride)
          : null,
        input.createdBy,
      ],
    )
    db.run(`UPDATE playbooks SET current_version_id = ? WHERE id = ?`, [
      versionId,
      playbookId,
    ])
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    if (
      e instanceof Error &&
      /UNIQUE constraint failed: playbooks\.name/i.test(e.message)
    ) {
      throw new PlaybookNameTakenError(input.name)
    }
    throw e
  }

  const result = getPlaybookById(db, playbookId)
  if (!result) throw new Error('createPlaybook: row disappeared after insert')
  return result
}

export type UpdatePlaybookInput = {
  displayName?: string
  description?: string
  promptTemplate?: string
  defaultsJson?: string
  allowedToolsOverride?: string[] | null
  createdBy: string
}

export function updatePlaybook(
  db: Database,
  id: string,
  input: UpdatePlaybookInput,
): Playbook {
  const existing = getPlaybookById(db, id)
  if (!existing) throw new PlaybookNotFoundError(id)
  if (existing.archived) throw new PlaybookArchivedError(existing.name)

  const prev = existing.currentVersion
  const newVersionId = generateId()
  const nextNumber = prev.versionNumber + 1

  const promptTemplate = input.promptTemplate ?? prev.promptTemplate
  const defaultsJson = input.defaultsJson ?? prev.defaultsJson
  const allowedToolsOverride =
    input.allowedToolsOverride !== undefined
      ? input.allowedToolsOverride
      : prev.allowedToolsOverride
  const displayName = input.displayName ?? existing.displayName
  const description = input.description ?? existing.description

  db.exec('BEGIN')
  try {
    db.run(
      `INSERT INTO playbook_versions
         (id, playbook_id, version_number, prompt_template, defaults_json, allowed_tools_override, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        newVersionId,
        id,
        nextNumber,
        promptTemplate,
        defaultsJson,
        allowedToolsOverride ? JSON.stringify(allowedToolsOverride) : null,
        input.createdBy,
      ],
    )
    db.run(
      `UPDATE playbooks SET display_name = ?, description = ?, current_version_id = ? WHERE id = ?`,
      [displayName, description, newVersionId, id],
    )
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  const result = getPlaybookById(db, id)
  if (!result) throw new Error('updatePlaybook: row disappeared after insert')
  return result
}

export function archivePlaybook(db: Database, id: string): Playbook {
  const existing = getPlaybookById(db, id)
  if (!existing) throw new PlaybookNotFoundError(id)
  db.run(`UPDATE playbooks SET archived = 1 WHERE id = ?`, [id])
  const result = getPlaybookById(db, id)
  if (!result) throw new Error('archivePlaybook: row disappeared')
  return result
}

export function unarchivePlaybook(db: Database, id: string): Playbook {
  const existing = getPlaybookById(db, id)
  if (!existing) throw new PlaybookNotFoundError(id)
  db.run(`UPDATE playbooks SET archived = 0 WHERE id = ?`, [id])
  const result = getPlaybookById(db, id)
  if (!result) throw new Error('unarchivePlaybook: row disappeared')
  return result
}
