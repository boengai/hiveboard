// packages/api/src/orchestrator/prespawn/load-required-secrets.ts
import type { Database } from 'bun:sqlite'
import { parseRequiredSecrets } from '../../secrets/store'
import type { RequiredSecretMeta } from './types'

export function loadRequiredSecrets(
  db: Database,
  taskId: string,
): RequiredSecretMeta[] {
  const taskRow = db
    .query('SELECT board_id, required_secrets FROM tasks WHERE id = ?')
    .get(taskId) as { board_id: string; required_secrets: string | null } | null
  if (!taskRow) return []
  const names = parseRequiredSecrets(taskRow.required_secrets)
  return names.map((name) => {
    const boardRow = db
      .query(
        'SELECT description FROM board_secrets WHERE board_id = ? AND name = ?',
      )
      .get(taskRow.board_id, name) as { description: string | null } | null
    return { name, description: boardRow?.description ?? null }
  })
}
