// packages/api/src/orchestrator/prespawn/load-playbook-tools.ts
import type { Database } from 'bun:sqlite'
import { getPlaybookByName } from '../../playbooks'

export function loadPlaybookTools(
  db: Database,
  action: string | null,
): string[] | null | undefined {
  if (!action?.startsWith('playbook:')) return undefined
  const name = action.slice('playbook:'.length)
  const pb = getPlaybookByName(db, name)
  return pb ? pb.currentVersion.allowedToolsOverride : undefined
}
