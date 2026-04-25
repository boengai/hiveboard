import { db } from '../../db'
import { verifyAndGate } from '../verify'
import { applyVerificationFailure } from './apply-verification-failure'
import { finalizeSuccess } from './finalize-success'
import type { OutcomeDeps } from './shared'

/**
 * Natural success path. Three stages, ordered:
 *
 *   1. `processSubtaskManifest` — materialize children before verify so
 *      a verify failure on the parent doesn't block child enqueue.
 *   2. `verifyAndGate` — for `implement` / `revise`, run the configured
 *      verify commands. A `'fail'` verdict short-circuits to
 *      `applyVerificationFailure` and skips finalize.
 *   3. `finalizeSuccess` — PR resolution, column move, dependent
 *      republish.
 *
 * The whole chain is a single Outcome by design: each stage either
 * passes through or hands off to a sibling outcome (verify-fail).
 * No nesting beyond that.
 */
export async function applySuccess(deps: OutcomeDeps): Promise<void> {
  const { task, runId, config, workspacePath, processSubtaskManifest } = deps

  await processSubtaskManifest(task)

  if (task.action === 'implement' || task.action === 'revise') {
    if (workspacePath && config.verify.enabled) {
      const verdict = await verifyAndGate({
        agentRunId: runId,
        config,
        db,
        taskId: task.id,
        workspacePath,
      })
      if (verdict === 'fail') {
        applyVerificationFailure(deps, runId)
        return
      }
    }
  }

  await finalizeSuccess(deps)
}
