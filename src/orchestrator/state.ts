import type { Issue, RetryEntry, RunState } from "../types/issue.ts";

/** Central orchestrator state. */
export interface OrchestratorState {
  running: Map<string, RunState>;
  completed: Set<string>;
  retryAttempts: Map<string, RetryEntry>;
}

export function createInitialState(): OrchestratorState {
  return {
    running: new Map(),
    completed: new Set(),
    retryAttempts: new Map(),
  };
}

/** Actions that are dispatched to agents. Others (like "review") are human-only. */
const DISPATCHABLE_ACTIONS = new Set([
  "plan",
  "implement",
  "implement-e2e",
  "revise",
]);

/** Check if an issue is eligible for dispatch. */
export function isEligible(state: OrchestratorState, issue: Issue): boolean {
  return (
    !state.running.has(issue.id) &&
    !state.completed.has(`${issue.id}:${issue.action}`) &&
    issue.action !== null &&
    DISPATCHABLE_ACTIONS.has(issue.action)
  );
}

/** Count running agents, optionally filtered by worker host. */
export function runningCount(
  state: OrchestratorState,
  workerHost?: string | null,
): number {
  if (workerHost === undefined) return state.running.size;

  let count = 0;
  for (const rs of state.running.values()) {
    if (rs.workerHost === workerHost) count++;
  }
  return count;
}
