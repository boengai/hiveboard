/**
 * Board column lookup helpers used by the orchestrator and outcome appliers.
 */

import { db } from '../db'

/**
 * Find the "In Progress" column ID for a board.
 * Looks for a column named "In Progress" (case-insensitive).
 * Falls back to the second column if found, or null.
 */
export function findColumnId(
  boardId: string,
  preferredName: string,
): string | null {
  const row = db
    .query(
      `SELECT id FROM columns WHERE board_id = ? AND lower(name) = lower(?) ORDER BY position ASC LIMIT 1`,
    )
    .get(boardId, preferredName) as { id: string } | null
  return row?.id ?? null
}

export function findColumnName(columnId: string): string | null {
  const row = db
    .query('SELECT name FROM columns WHERE id = ?')
    .get(columnId) as { name: string } | null
  return row?.name ?? null
}
