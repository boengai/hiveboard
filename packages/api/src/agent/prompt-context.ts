/**
 * Canonical prompt context shape and builder. The single source of truth
 * for what an agent prompt sees, regardless of whether it's rendered
 * from `WORKFLOW.md` or a playbook body. Both paths must build context
 * through `buildPromptContext` so that drift between them is impossible.
 *
 * Architecturally: the prompt template is the surface presented to the
 * agent; the context shape is its parameter list. A second copy of the
 * builder = a second parameter list = silent feature divergence.
 */

import type {
  PreviousAttemptReplayForPrompt,
  RunAgentMessage,
  TaskForPrompt,
  VerificationFailureForPrompt,
} from './prompt'

export type PromptInput = {
  task: TaskForPrompt
  attempt?: number
  reviewComments?: string
  scratchpad?: string
  messages?: RunAgentMessage[]
  verificationFailures?: VerificationFailureForPrompt[]
  previousAttemptReplay?: PreviousAttemptReplayForPrompt
  requiredSecrets?: Array<{ name: string; description?: string | null }>
}

export type PromptContext = {
  task: {
    id: string
    title: string
    body: string
    action: string
    agent_instruction: string
    repo_owner: string
    repo_name: string
    target_branch: string
    pr_url: string
  }
  attempt?: number
  review_comments?: string
  has_review_comments: boolean
  scratchpad: string
  messages: RunAgentMessage[]
  has_messages: boolean
  auto_revise_from_verification: boolean
  verification_failures: VerificationFailureForPrompt[]
  previous_attempt_replay?: PreviousAttemptReplayForPrompt
  has_required_secrets: boolean
  required_secrets_list: Array<{ name: string; description?: string | null }>
}

export function buildPromptContext(input: PromptInput): PromptContext {
  const { task } = input
  const [repoOwner, repoName] = (task.targetRepo ?? '/').split('/')

  const combinedBody = task.plan
    ? `${task.body.trimEnd()}\n\n## Implementation Plan\n\n${task.plan.trim()}`
    : task.body

  return {
    attempt: input.attempt,
    auto_revise_from_verification:
      (input.verificationFailures?.length ?? 0) > 0,
    has_messages: (input.messages?.length ?? 0) > 0,
    has_required_secrets: (input.requiredSecrets?.length ?? 0) > 0,
    has_review_comments: !!input.reviewComments,
    messages: input.messages ?? [],
    previous_attempt_replay: input.previousAttemptReplay,
    required_secrets_list: input.requiredSecrets ?? [],
    review_comments: input.reviewComments,
    scratchpad: input.scratchpad ?? '',
    task: {
      action: task.action ?? '',
      agent_instruction: task.agentInstruction ?? '',
      body: combinedBody,
      id: task.id,
      pr_url: task.prUrl ?? '',
      repo_name: repoName ?? '',
      repo_owner: repoOwner ?? '',
      target_branch: task.targetBranch ?? 'main',
      title: task.title,
    },
    verification_failures: input.verificationFailures ?? [],
  }
}
