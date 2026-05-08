// packages/api/src/orchestrator/prespawn/plan.ts
import { resolveSecretsForTask } from '../../secrets/store'
import { buildPreviousAttemptReplay } from '../../agent/checkpoint-replay'
import { loadPlaybookTools } from './load-playbook-tools'
import { loadRequiredSecrets } from './load-required-secrets'
import { loadReviewComments } from './load-review-comments'
import { loadUndeliveredMessages } from './load-undelivered-messages'
import { loadVerificationFailures } from './load-verification-failures'
import type { PrespawnDeps, PrespawnResult, SpawnPlan, TaskSubsetForRun } from './types'
import type { TaskRow } from '../orchestrator'

function taskSubset(task: TaskRow): TaskSubsetForRun {
  return {
    id: task.id,
    title: task.title,
    body: task.body,
    plan: task.plan,
    action: task.action,
    agentInstruction: task.agent_instruction,
    targetRepo: task.target_repo,
    targetBranch: task.target_branch,
    prUrl: task.pr_url,
  }
}

export async function plan(
  task: TaskRow,
  deps: PrespawnDeps,
): Promise<PrespawnResult> {
  // 1. Secrets gate first — fail fast before any other I/O. Honors §5.1
  //    rationale: missing-secrets must not fetch PR comments or build a
  //    spawn plan we won't use.
  const secretsResolution = resolveSecretsForTask(deps.db, task.id)
  if (!secretsResolution.ok) {
    return { kind: 'missing_secrets', missing: secretsResolution.missing }
  }

  // 2. Verification-failure replay (also yields the clear-pointer commit).
  const vf = loadVerificationFailures(deps.db, task.id)

  // 3. PR review comments — only revise + pr_url, swallows transport errors.
  const reviewComments = await loadReviewComments(
    { action: task.action, prUrl: task.pr_url },
    deps.github,
  )

  // 4. Undelivered messages (also yields the deliveredMessageIds commit).
  const um = loadUndeliveredMessages(deps.db, task.id)

  // 5. Playbook tool override (undefined for non-playbook actions).
  const allowedToolsOverride = loadPlaybookTools(deps.db, task.action)

  // 6. Previous-attempt replay only when retrying.
  const retryAttempt = task.retry_count ?? 0
  const previousAttemptReplay =
    retryAttempt > 0
      ? buildPreviousAttemptReplay(deps.db, task.id) ?? undefined
      : undefined

  // 7. Required-secrets metadata for the prompt context.
  const requiredSecrets = loadRequiredSecrets(deps.db, task.id)

  const spawnPlan: SpawnPlan = {
    task: taskSubset(task),
    retryAttempt,
    messages: um.messages,
    reviewComments,
    verificationFailures: vf.failures,
    previousAttemptReplay,
    requiredSecrets,
    allowedToolsOverride,
    secretsEnv: secretsResolution.env,
    secretValues: secretsResolution.values,
    commits: {
      deliveredMessageIds: um.deliveredMessageIds,
      clearPendingAutoReviseFor: vf.clearPendingAutoReviseFor,
    },
  }
  return { kind: 'ok', plan: spawnPlan }
}
