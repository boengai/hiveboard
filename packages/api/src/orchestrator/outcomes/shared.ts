import type { Config } from '../../config/schema'
import type { GitHubClient } from '../../github/client'
import type { TaskRow } from '../orchestrator'

/**
 * Per-call dependency bundle handed to every `apply*` outcome handler.
 * The orchestrator builds one of these in `onComplete` and passes it
 * through to the dispatched handler.
 *
 * Anything an outcome needs from the orchestrator instance lives here.
 * If you find yourself reaching back to `Orchestrator` for state,
 * surface it on `OutcomeDeps` instead.
 */
export type OutcomeDeps = {
  task: TaskRow
  runId: string
  result: { taskId: string; success: boolean; output: string; error?: string }
  /** Workspace path of the just-completed run. Required for the verify gate. */
  workspacePath: string | undefined
  config: Config
  github: GitHubClient
  /** Materialize subtask manifest written to `$HIVEBOARD_SUBTASKS`. */
  processSubtaskManifest: (task: TaskRow) => Promise<void>
  /** Schedule a backoff-delayed retry after a natural failure. */
  scheduleRetry: (task: TaskRow, error: string) => Promise<void>
}
