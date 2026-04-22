import type { Database } from 'bun:sqlite'
import { parse as parseYaml } from 'yaml'
import { addDependencyEdge } from '../db/task-dependencies'
import { generateId } from '../db/ulid'

export const MAX_SUBTASKS_PER_MANIFEST = 20

export type ParsedSubtask = {
  title: string
  body: string
  action: 'plan' | 'implement' | 'revise'
  target_branch: string | null
  tags: string[]
  depends_on_siblings: number[]
}

export type SubtaskManifest = {
  subtasks: ParsedSubtask[]
}

export type SubtaskManifestValidationError = {
  index: number | null
  code:
    | 'YAML_PARSE'
    | 'ROOT_SHAPE'
    | 'TOO_MANY_SUBTASKS'
    | 'TITLE_MISSING'
    | 'ACTION_INVALID'
    | 'TAGS_SHAPE'
    | 'DEP_INDEX_SHAPE'
    | 'DEP_INDEX_OUT_OF_RANGE'
  message: string
}

export type ParseResult =
  | { kind: 'ok'; manifest: SubtaskManifest }
  | { kind: 'error'; errors: SubtaskManifestValidationError[] }

const VALID_ACTIONS = new Set(['plan', 'implement', 'revise'])

export function parseSubtasksManifest(yaml: string): ParseResult {
  let raw: unknown
  try {
    raw = parseYaml(yaml)
  } catch (err) {
    return {
      errors: [
        {
          code: 'YAML_PARSE',
          index: null,
          message: `YAML parse error: ${(err as Error).message}`,
        },
      ],
      kind: 'error',
    }
  }

  if (
    raw === null ||
    typeof raw !== 'object' ||
    !Array.isArray((raw as { subtasks?: unknown }).subtasks)
  ) {
    return {
      errors: [
        {
          code: 'ROOT_SHAPE',
          index: null,
          message: 'Root document must be a mapping with a `subtasks` array.',
        },
      ],
      kind: 'error',
    }
  }

  const list = (raw as { subtasks: unknown[] }).subtasks
  const errors: SubtaskManifestValidationError[] = []

  if (list.length > MAX_SUBTASKS_PER_MANIFEST) {
    errors.push({
      code: 'TOO_MANY_SUBTASKS',
      index: null,
      message: `Too many subtasks: ${list.length} (max ${MAX_SUBTASKS_PER_MANIFEST}).`,
    })
  }

  const parsed: ParsedSubtask[] = []
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    if (item === null || typeof item !== 'object') {
      errors.push({
        code: 'ROOT_SHAPE',
        index: i,
        message: `subtasks[${i}] must be a mapping.`,
      })
      continue
    }
    const rec = item as Record<string, unknown>

    const title = typeof rec.title === 'string' ? rec.title.trim() : ''
    if (title.length === 0) {
      errors.push({
        code: 'TITLE_MISSING',
        index: i,
        message: `subtasks[${i}].title is required and must be non-empty.`,
      })
      continue
    }

    const action =
      typeof rec.action === 'string'
        ? rec.action.trim().toLowerCase()
        : 'implement'
    if (!VALID_ACTIONS.has(action)) {
      errors.push({
        code: 'ACTION_INVALID',
        index: i,
        message: `subtasks[${i}].action must be one of plan|implement|revise.`,
      })
      continue
    }

    const body = typeof rec.body === 'string' ? rec.body : ''
    const target_branch =
      typeof rec.target_branch === 'string' && rec.target_branch.length > 0
        ? rec.target_branch
        : null

    let tags: string[] = []
    if (rec.tags !== undefined) {
      if (
        !Array.isArray(rec.tags) ||
        !rec.tags.every((t) => typeof t === 'string')
      ) {
        errors.push({
          code: 'TAGS_SHAPE',
          index: i,
          message: `subtasks[${i}].tags must be an array of strings.`,
        })
        continue
      }
      tags = rec.tags as string[]
    }

    let depIndices: number[] = []
    if (rec.depends_on_siblings !== undefined) {
      if (
        !Array.isArray(rec.depends_on_siblings) ||
        !rec.depends_on_siblings.every((n) => Number.isInteger(n))
      ) {
        errors.push({
          code: 'DEP_INDEX_SHAPE',
          index: i,
          message: `subtasks[${i}].depends_on_siblings must be an integer array.`,
        })
        continue
      }
      depIndices = rec.depends_on_siblings as number[]
    }
    for (const d of depIndices) {
      // Topological constraint: a subtask can only depend on earlier-indexed
      // siblings. This makes cycles impossible by construction (a DAG with
      // edges pointing only backwards in the array), so we don't need a
      // runtime cycle check in createSubtasksFromManifest.
      if (d < 0 || d >= list.length || d >= i) {
        errors.push({
          code: 'DEP_INDEX_OUT_OF_RANGE',
          index: i,
          message: `subtasks[${i}].depends_on_siblings contains invalid index ${d} (must refer to an earlier sibling: 0 ≤ d < ${i}).`,
        })
      }
    }

    parsed.push({
      action: action as 'plan' | 'implement' | 'revise',
      body,
      depends_on_siblings: depIndices,
      tags,
      target_branch,
      title,
    })
  }

  if (errors.length > 0) return { errors, kind: 'error' }
  return { kind: 'ok', manifest: { subtasks: parsed } }
}

type ParentRow = {
  id: string
  board_id: string
  target_repo: string | null
  target_branch: string | null
}

type ColumnRow = { id: string; name: string; position: number }
type TagRow = { id: string; name: string }

/**
 * Materialize a validated manifest as child tasks of `parentId`. Each child
 * inherits parent's board/repo/branch/tags; `target_branch` override wins if
 * set. Sibling deps from `depends_on_siblings` become `task_dependencies`
 * rows. Everything is executed inside one SQLite transaction — any single
 * failure rolls back the whole batch and re-throws.
 *
 * Returns the list of created child task ids, in manifest order.
 *
 * Preconditions (caller ensures):
 * - `parentId` exists
 * - `manifest` has already been validated by `parseSubtasksManifest`
 *
 * Throws if a tag name in any subtask does not exist on the parent's board,
 * or if any DB operation fails.
 */
export function createSubtasksFromManifest(
  db: Database,
  parentId: string,
  manifest: SubtaskManifest,
  actorUserId: string,
): string[] {
  const parent = db
    .query(
      'SELECT id, board_id, target_repo, target_branch FROM tasks WHERE id = ?',
    )
    .get(parentId) as ParentRow | null
  if (!parent) throw new Error(`Parent task not found: ${parentId}`)

  const firstCol = db
    .query(
      'SELECT id, name, position FROM columns WHERE board_id = ? ORDER BY position ASC LIMIT 1',
    )
    .get(parent.board_id) as ColumnRow | null
  if (!firstCol) throw new Error(`Board ${parent.board_id} has no columns`)

  const inheritedTagIds = (
    db
      .query('SELECT tag_id FROM task_tags WHERE task_id = ?')
      .all(parentId) as Array<{ tag_id: string }>
  ).map((r) => r.tag_id)

  const tagNameToId = new Map<string, string>()
  const allBoardTags = db
    .query('SELECT id, name FROM tags WHERE board_id = ?')
    .all(parent.board_id) as TagRow[]
  for (const t of allBoardTags) tagNameToId.set(t.name, t.id)

  for (let i = 0; i < manifest.subtasks.length; i++) {
    for (const name of manifest.subtasks[i]?.tags) {
      if (!tagNameToId.has(name)) {
        throw new Error(
          `subtasks[${i}].tags references unknown tag "${name}" on board ${parent.board_id}`,
        )
      }
    }
  }

  const createdIds: string[] = []

  db.transaction(() => {
    const maxRow = db
      .query('SELECT MAX(position) AS max_pos FROM tasks WHERE column_id = ?')
      .get(firstCol.id) as { max_pos: number | null }
    let nextPos = maxRow.max_pos !== null ? maxRow.max_pos + 1024 : 0

    for (const st of manifest.subtasks) {
      const id = generateId()
      const targetBranch = st.target_branch ?? parent.target_branch ?? 'main'

      db.run(
        `INSERT INTO tasks (
           id, board_id, column_id, title, body, position,
           action, target_repo, target_branch,
           agent_status, queue_after,
           parent_task_id,
           created_by, updated_by
         )
         VALUES (?, ?, ?, ?, ?, ?,
                 ?, ?, ?,
                 'queued', datetime('now'),
                 ?,
                 ?, ?)`,
        [
          id,
          parent.board_id,
          firstCol.id,
          st.title,
          st.body,
          nextPos,
          st.action,
          parent.target_repo,
          targetBranch,
          parentId,
          actorUserId,
          actorUserId,
        ],
      )
      nextPos += 1024

      const tagIds = new Set<string>(inheritedTagIds)
      for (const name of st.tags) {
        const tid = tagNameToId.get(name)
        if (tid) tagIds.add(tid)
      }
      for (const tid of tagIds) {
        db.run(
          'INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)',
          [id, tid],
        )
      }

      db.run(
        'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
        [
          generateId(),
          id,
          'SYSTEM',
          'created',
          JSON.stringify({ spawned_by_parent: parentId }),
        ],
      )

      createdIds.push(id)
    }

    for (let i = 0; i < manifest.subtasks.length; i++) {
      const st = manifest.subtasks[i]!
      const thisId = createdIds[i]!
      for (const depIdx of st.depends_on_siblings) {
        const blockerId = createdIds[depIdx]!
        addDependencyEdge(db, thisId, blockerId)
      }
    }
  })()

  return createdIds
}
