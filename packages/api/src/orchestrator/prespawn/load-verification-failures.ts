// packages/api/src/orchestrator/prespawn/load-verification-failures.ts
import type { Database } from 'bun:sqlite'
import { listFailingRunsForAgentRun } from '../../db/verification-runs'
import { formatVerificationFailureForAgent } from '../verify'
import type { VerificationFailureForAgent } from './types'

export type LoadVerificationFailuresResult = {
  failures: VerificationFailureForAgent[]
  /** When non-null, the orchestrator must NULL the pointer at commit time. */
  clearPendingAutoReviseFor: string | null
}

export function loadVerificationFailures(
  db: Database,
  taskId: string,
): LoadVerificationFailuresResult {
  const row = db
    .query('SELECT pending_auto_revise_source_run_id FROM tasks WHERE id = ?')
    .get(taskId) as { pending_auto_revise_source_run_id: string | null } | null

  if (!row?.pending_auto_revise_source_run_id) {
    return { failures: [], clearPendingAutoReviseFor: null }
  }

  const sourceRunId = row.pending_auto_revise_source_run_id
  const failing = listFailingRunsForAgentRun(db, sourceRunId)
  if (failing.length === 0) {
    return { failures: [], clearPendingAutoReviseFor: taskId }
  }

  const fmt = formatVerificationFailureForAgent(
    failing.map((f) => ({
      command: f.command,
      exit_code: f.exitCode,
      finished_at: f.finishedAt,
      label: f.label,
      output: f.output,
      started_at: f.startedAt,
    })),
  )
  return {
    failures: fmt.verification_failures,
    clearPendingAutoReviseFor: taskId,
  }
}
