/**
 * Legacy type definitions for the src/ layer.
 * These are kept for backward compatibility while the src/ layer is being
 * superseded by packages/api/. The canonical types now live in packages/api/src/.
 */

/** Normalized issue model used across the legacy system. */
export interface Issue {
  id: string;
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  /** Label name → node ID map (from GraphQL) */
  labelIds: Record<string, string>;
  url: string;
  assignee: string | null;

  /** The repo where this issue lives (from GraphQL) */
  sourceOwner: string;
  sourceRepo: string;

  /** The target repo to work in (from DB field `target_repo`) */
  repoOwner: string | null;
  repoName: string | null;

  /** The action to perform */
  action: string | null;
}

/** Result of running an agent for an issue. */
export interface AgentResult {
  issueId: string;
  success: boolean;
  output: string;
  error?: string;
}

/** State of a running agent. */
export interface RunState {
  issueId: string;
  issue: Issue;
  process: Subprocess | null;
  workerHost: string | null;
  workspacePath: string | null;
  retryAttempt: number;
  startedAt: Date;
  abortController: AbortController;
}

/** Retry tracking entry. */
export interface RetryEntry {
  attempt: number;
  timer: Timer | null;
  dueAtMs: number;
  identifier: string;
  error: string | null;
  workerHost: string | null;
  workspacePath: string | null;
}

type Subprocess = import("bun").Subprocess;
