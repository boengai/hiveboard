/**
 * Pure picker for the post-exit pipeline (architecture.md §5.2).
 *
 * Given the run-time signals the orchestrator gathers when an agent process
 * exits — the abort reason on the RunState, the agent's result, the contents
 * of `$HIVEBOARD_QUESTION` if any — return a discriminated `Outcome` whose
 * `kind` selects which `apply*` handler runs.
 *
 * Priority is encoded here, once. See `CONTEXT.md` → "Outcome".
 */

export type Outcome =
  | { kind: 'timeout' }
  | { kind: 'question'; question: string }
  | { kind: 'success' }
  | { kind: 'failure' }

export type OutcomeSignals = {
  /** Abort reason recorded on the RunState — `'TIMEOUT'` wins over everything. */
  abortReason: 'TIMEOUT' | 'REDIRECT' | 'CANCEL' | undefined
  /** The agent process exit summary. */
  result: { success: boolean }
  /**
   * Contents of `$HIVEBOARD_QUESTION` (already read from disk and
   * trimmed). An empty string means "no question". A QUESTION outcome is
   * only valid when `abortReason !== 'TIMEOUT'` — a mid-thought kill
   * cannot have produced a clean question.
   */
  question: string
}

export function decideOutcome(signals: OutcomeSignals): Outcome {
  // 1. TIMEOUT wins over everything: the agent was killed mid-thought, so
  //    any side files (question, output) cannot be trusted as clean signals.
  if (signals.abortReason === 'TIMEOUT') {
    return { kind: 'timeout' }
  }

  // 2. QUESTION wins over the natural exit code: a blocked-on-uncertainty
  //    agent has almost certainly not finished its work, so we treat it as
  //    blocked even if the process happened to exit zero.
  if (signals.question.length > 0) {
    return { kind: 'question', question: signals.question }
  }

  // 3. Otherwise the exit code decides.
  return signals.result.success ? { kind: 'success' } : { kind: 'failure' }
}
