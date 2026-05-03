// packages/api/src/orchestrator/prespawn/types.ts
import type { Database } from 'bun:sqlite'
import type { ReviewComment } from '../../github/client'
import type { VerificationFailureForPrompt } from '../../agent/prompt'
import type { RunAgentMessage, TaskForAgent, PreviousAttemptReplay } from '../../agent/runner'

export type TaskSubsetForRun = TaskForAgent

export type PromptMessage = RunAgentMessage

export type VerificationFailureForAgent = VerificationFailureForPrompt

export type RequiredSecretMeta = {
  name: string
  description: string | null
}

export type SpawnPlanCommits = {
  /** Message ids whose `delivered_at` must be stamped at commit time. */
  deliveredMessageIds: string[]
  /** When non-null, NULL the `pending_auto_revise_source_run_id` for this task id. */
  clearPendingAutoReviseFor: string | null
}

export type SpawnPlan = {
  task: TaskSubsetForRun
  retryAttempt: number

  messages: PromptMessage[]
  reviewComments: string | undefined
  verificationFailures: VerificationFailureForAgent[]
  previousAttemptReplay: PreviousAttemptReplay | undefined
  requiredSecrets: RequiredSecretMeta[]
  allowedToolsOverride: string[] | null | undefined

  secretsEnv: Record<string, string>
  secretValues: string[]

  commits: SpawnPlanCommits
}

export type PrespawnResult =
  | { kind: 'ok'; plan: SpawnPlan }
  | { kind: 'missing_secrets'; missing: string[] }

export interface GitHubReviewCommentsAdapter {
  fetchReviewComments(prUrl: string): Promise<ReviewComment[]>
}

export type PrespawnDeps = {
  db: Database
  github: GitHubReviewCommentsAdapter
}
