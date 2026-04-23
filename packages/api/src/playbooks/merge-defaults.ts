import type { Database } from 'bun:sqlite'
import { consola } from 'consola'
import { generateId } from '../db/ulid'
import type { PlaybookVersion } from './index'

type PlaybookDefaults = {
  target_branch?: string
  tags?: string[]
  verify_commands?: string[]
  time_box_ms?: number
}

function parseDefaults(json: string): PlaybookDefaults {
  try {
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as PlaybookDefaults
  } catch (e) {
    consola.warn(
      `mergePlaybookDefaults: invalid defaults_json, ignoring: ${(e as Error).message}`,
    )
    return {}
  }
}

/**
 * Merge a playbook version's defaults into the task row. Task-level values
 * win where both are set. Tags are unioned (not replaced). The merge writes
 * resolved values back to the row so subsequent runs don't re-merge.
 */
export function mergePlaybookDefaultsIntoTask(
  db: Database,
  taskId: string,
  version: PlaybookVersion,
): void {
  const defaults = parseDefaults(version.defaultsJson)

  const task = db
    .query(
      `SELECT board_id, target_branch, verify_commands, time_box_ms FROM tasks WHERE id = ?`,
    )
    .get(taskId) as {
    board_id: string
    target_branch: string | null
    verify_commands: string | null
    time_box_ms: number | null
  } | null
  if (!task) return

  db.exec('BEGIN')
  try {
    if (!task.target_branch && defaults.target_branch) {
      db.run(`UPDATE tasks SET target_branch = ? WHERE id = ?`, [
        defaults.target_branch,
        taskId,
      ])
    }

    if (task.verify_commands == null && Array.isArray(defaults.verify_commands)) {
      db.run(`UPDATE tasks SET verify_commands = ? WHERE id = ?`, [
        JSON.stringify(defaults.verify_commands),
        taskId,
      ])
    }

    if (task.time_box_ms == null && typeof defaults.time_box_ms === 'number') {
      db.run(`UPDATE tasks SET time_box_ms = ? WHERE id = ?`, [
        defaults.time_box_ms,
        taskId,
      ])
    }

    if (Array.isArray(defaults.tags) && defaults.tags.length > 0) {
      for (const tagName of defaults.tags) {
        let tagRow = db
          .query('SELECT id FROM tags WHERE board_id = ? AND name = ?')
          .get(task.board_id, tagName) as { id: string } | null
        if (!tagRow) {
          const newId = generateId()
          db.run(
            'INSERT INTO tags (id, board_id, name) VALUES (?, ?, ?)',
            [newId, task.board_id, tagName],
          )
          tagRow = { id: newId }
        }
        db.run(
          'INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)',
          [taskId, tagRow.id],
        )
      }
    }

    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
