import { consola } from "consola";
import { runAgent } from "../agent/runner.ts";
import type { Config } from "../config/schema.ts";
import type { GitHubClient } from "../github/client.ts";
import type { FormattedReviewComment } from "../github/types.ts";
import type { AgentResult, Issue, RunState } from "../types/issue.ts";
import type { WorkspaceManager } from "../workspace/manager.ts";
import {
  createInitialState,
  isEligible,
  type OrchestratorState,
  runningCount,
} from "./state.ts";

export class Orchestrator {
  private state: OrchestratorState;
  private pollTimer: Timer | null = null;
  private sweepTimer: Timer | null = null;
  private shutdownRequested = false;

  constructor(
    private config: Config,
    private github: GitHubClient,
    private workspace: WorkspaceManager,
    private promptTemplate: string,
  ) {
    this.state = createInitialState();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Start the polling loop. */
  start(): void {
    consola.info(
      `Orchestrator started (poll every ${this.config.polling.interval_ms}ms, max ${this.config.agent.max_concurrent_agents} agents)`,
    );
    this.schedulePoll();
    this.scheduleSweep();
  }

  /** Graceful shutdown: wait for running agents then stop. */
  async shutdown(): Promise<void> {
    this.shutdownRequested = true;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.sweepTimer) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = null;
    }

    // Cancel retry timers
    for (const entry of this.state.retryAttempts.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }

    consola.info(
      `Shutting down... waiting for ${this.state.running.size} running agents`,
    );

    // Abort all running agents
    for (const rs of this.state.running.values()) {
      rs.abortController.abort();
    }

    // Wait for all to finish (with timeout)
    const timeout = 30_000;
    const start = Date.now();
    while (this.state.running.size > 0 && Date.now() - start < timeout) {
      await Bun.sleep(500);
    }

    if (this.state.running.size > 0) {
      consola.warn(
        `Shutdown timeout: ${this.state.running.size} agents still running`,
      );
    }

    consola.info("Orchestrator shut down");
  }

  // -------------------------------------------------------------------------
  // Polling
  // -------------------------------------------------------------------------

  private schedulePoll(): void {
    if (this.shutdownRequested) return;

    this.pollTimer = setTimeout(async () => {
      await this.poll();
      this.schedulePoll();
    }, this.config.polling.interval_ms);
  }

  /** Sweep expired workspaces every hour. */
  private scheduleSweep(): void {
    if (this.shutdownRequested) return;
    if (this.workspace.ttlMs <= 0) return;

    const SWEEP_INTERVAL = 3_600_000; // 1 hour
    this.sweepTimer = setTimeout(async () => {
      try {
        await this.workspace.sweepExpired();
      } catch (err) {
        consola.error("Workspace sweep failed:", err);
      }
      this.scheduleSweep();
    }, SWEEP_INTERVAL);
  }

  /** Run a single poll cycle: fetch issues, reconcile, dispatch. */
  async poll(): Promise<void> {
    if (this.shutdownRequested) return;

    try {
      // Refresh installation token (no-op for PAT auth)
      await this.github.refreshToken();

      const issues = await this.github.fetchProjectItems();
      consola.debug(`Polled ${issues.length} project items`);

      await this.reconcile(issues);
      await this.dispatch(issues);
    } catch (err) {
      consola.error("Poll cycle failed:", err);
    }
  }

  // -------------------------------------------------------------------------
  // Reconciliation
  // -------------------------------------------------------------------------

  /** Reconcile running agents against current issue states. */
  private async reconcile(issues: Issue[]): Promise<void> {
    const issueMap = new Map(issues.map((i) => [i.id, i]));

    for (const [issueId, rs] of this.state.running) {
      const current = issueMap.get(issueId);

      if (!current) {
        // Issue disappeared from project
        consola.warn(`Issue ${issueId} no longer in project, stopping agent`);
        rs.abortController.abort();
        continue;
      }

      // If issue no longer has an action label, it might have been handled
      if (
        !current.action &&
        !current.labels.includes(this.github.runningLabel)
      ) {
        consola.info(
          `Issue #${current.number} no longer actionable, stopping agent`,
        );
        rs.abortController.abort();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Dispatch
  // -------------------------------------------------------------------------

  /** Select and dispatch eligible issues. */
  private async dispatch(issues: Issue[]): Promise<void> {
    const eligible = issues.filter((i) => isEligible(this.state, i));

    const available =
      this.config.agent.max_concurrent_agents - this.state.running.size;
    if (available <= 0) {
      consola.debug(
        `Concurrency limit reached (${this.state.running.size}/${this.config.agent.max_concurrent_agents})`,
      );
      return;
    }

    const toDispatch = eligible.slice(0, available);

    for (const issue of toDispatch) {
      await this.dispatchIssue(issue);
    }
  }

  /** Dispatch a single issue. */
  private async dispatchIssue(issue: Issue): Promise<void> {
    const workerHost = this.selectWorkerHost();

    consola.info(
      `Dispatching issue #${issue.number} (action: ${issue.action})${workerHost ? ` to ${workerHost}` : ""}`,
    );

    try {
      // Resolve projectItemId if missing (webhook path doesn't have it)
      if (!issue.projectItemId) {
        issue.projectItemId = await this.github.findProjectItemId(issue.id);
      }

      // Update labels: remove action label, set status to running
      const actionLabel = this.github.actionLabel(issue.action ?? "");
      await this.github.removeLabels(issue.id, [actionLabel], issue);
      await this.github.setStatusLabel(
        issue.id,
        this.github.runningLabel,
        issue,
      );

      // Move to In Progress column (skip for plan — stays in Backlog)
      if (issue.projectItemId && issue.action !== "plan") {
        await this.github.moveToColumn(
          issue.projectItemId,
          this.config.tracker.columns.in_progress,
        );
      }

      // Fetch review comments for revise action
      let reviewComments: FormattedReviewComment[] | undefined;
      if (issue.action === "revise") {
        try {
          reviewComments = await this.github.fetchReviewComments(issue);
          consola.info(
            `Loaded ${reviewComments.length} review comments for issue #${issue.number}`,
          );
        } catch (err) {
          consola.warn(
            `Failed to fetch review comments for issue #${issue.number}:`,
            err,
          );
        }
      }

      // Create workspace with fresh access token for hook env
      const accessToken = await this.github.getAccessToken();
      const ws = await this.workspace.createForIssue(
        issue,
        workerHost,
        accessToken,
      );

      // Set up run state
      const abortController = new AbortController();
      const retryEntry = this.state.retryAttempts.get(issue.id);
      const retryAttempt = retryEntry?.attempt ?? 0;

      const runState: RunState = {
        issueId: issue.id,
        issue,
        process: null,
        workerHost: workerHost ?? null,
        workspacePath: ws.path,
        retryAttempt,
        startedAt: new Date(),
        abortController,
      };

      this.state.running.set(issue.id, runState);

      // Run agent (fire and forget — handled by onAgentComplete)
      this.runAgentAsync(
        issue,
        ws.path,
        workerHost,
        retryAttempt,
        abortController,
        reviewComments,
      );
    } catch (err) {
      consola.error(`Failed to dispatch issue #${issue.number}:`, err);
      this.state.running.delete(issue.id);
    }
  }

  /** Run agent asynchronously and handle completion. */
  private async runAgentAsync(
    issue: Issue,
    workspacePath: string,
    workerHost: string | null | undefined,
    retryAttempt: number,
    abortController: AbortController,
    reviewComments?: FormattedReviewComment[],
  ): Promise<void> {
    try {
      const result = await runAgent({
        issue,
        workspacePath,
        promptTemplate: this.promptTemplate,
        config: this.config,
        workerHost,
        retryAttempt,
        reviewComments,
        signal: abortController.signal,
      });

      await this.onAgentComplete(issue, result);
    } catch (err) {
      consola.error(`Agent crashed for issue #${issue.number}:`, err);
      await this.onAgentComplete(issue, {
        issueId: issue.id,
        success: false,
        output: "",
        error: String(err),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Completion & Retry
  // -------------------------------------------------------------------------

  /** Handle agent completion. */
  private async onAgentComplete(
    issue: Issue,
    result: AgentResult,
  ): Promise<void> {
    this.state.running.delete(issue.id);

    if (result.success) {
      consola.info(`Issue #${issue.number} completed successfully`);
      this.state.completed.add(`${issue.id}:${issue.action}`);
      this.state.retryAttempts.delete(issue.id);

      try {
        // Clear status labels
        await this.github.setStatusLabel(issue.id, null, issue);
        // Move column: plan → Todo, others → Review
        if (issue.projectItemId) {
          const column =
            issue.action === "plan"
              ? this.config.tracker.columns.todo
              : this.config.tracker.columns.review;
          await this.github.moveToColumn(issue.projectItemId, column);
        }
      } catch (err) {
        consola.error(
          `Failed to update labels/column for issue #${issue.number}:`,
          err,
        );
      }
    } else {
      consola.warn(
        `Issue #${issue.number} failed: ${result.error?.slice(0, 100)}`,
      );
      await this.scheduleRetry(issue, result.error ?? "Unknown error");
    }
  }

  /** Schedule a retry with exponential backoff. */
  private async scheduleRetry(issue: Issue, error: string): Promise<void> {
    const existing = this.state.retryAttempts.get(issue.id);
    const attempt = (existing?.attempt ?? 0) + 1;
    const baseDelay = 10_000; // 10 seconds
    const delay = Math.min(
      baseDelay * 2 ** (attempt - 1),
      this.config.agent.max_retry_backoff_ms,
    );

    consola.info(
      `Scheduling retry #${attempt} for issue #${issue.number} in ${delay}ms`,
    );

    try {
      // Set status to failed (removes running label automatically)
      await this.github.setStatusLabel(
        issue.id,
        this.github.failedLabel,
        issue,
      );
    } catch (err) {
      consola.error(`Failed to update labels for retry:`, err);
    }

    const timer = setTimeout(() => {
      this.state.retryAttempts.delete(issue.id);
      // Clear status and re-add action label so next poll picks it up
      this.github
        .setStatusLabel(issue.id, null, issue)
        .then(() =>
          this.github.addLabels(
            issue.id,
            [this.github.actionLabel(issue.action ?? "")],
            issue,
          ),
        )
        .catch((err) =>
          consola.error(`Failed to re-add action label for retry:`, err),
        );
    }, delay);

    this.state.retryAttempts.set(issue.id, {
      attempt,
      timer,
      dueAtMs: Date.now() + delay,
      identifier: `#${issue.number}`,
      error,
      workerHost: this.state.running.get(issue.id)?.workerHost ?? null,
      workspacePath: this.state.running.get(issue.id)?.workspacePath ?? null,
    });
  }

  // -------------------------------------------------------------------------
  // Worker host selection
  // -------------------------------------------------------------------------

  /** Select the least-loaded worker host, or null for local. */
  private selectWorkerHost(): string | null {
    const hosts = this.config.worker.ssh_hosts;
    if (hosts.length === 0) return null;

    const maxPerHost = this.config.worker.max_concurrent_agents_per_host;

    let bestHost: string | null = null;
    let bestCount = Infinity;

    for (const host of hosts) {
      const count = runningCount(this.state, host);
      if (count < maxPerHost && count < bestCount) {
        bestHost = host;
        bestCount = count;
      }
    }

    return bestHost;
  }

  // -------------------------------------------------------------------------
  // External API (for webhook integration)
  // -------------------------------------------------------------------------

  /** Enqueue an issue for immediate dispatch (from webhook). */
  async enqueueIssue(issue: Issue): Promise<void> {
    if (!isEligible(this.state, issue)) {
      consola.debug(
        `Issue #${issue.number} not eligible for dispatch (already running/completed)`,
      );
      return;
    }

    const available =
      this.config.agent.max_concurrent_agents - this.state.running.size;
    if (available <= 0) {
      consola.info(
        `Issue #${issue.number} enqueued but concurrency limit reached — will dispatch on next poll`,
      );
      return;
    }

    await this.dispatchIssue(issue);
  }

  /** Cancel a running agent for an issue (e.g. issue closed or unlabeled). */
  cancelIssue(issueId: string): void {
    const rs = this.state.running.get(issueId);
    if (rs) {
      consola.info(`Cancelling agent for issue ${issueId}`);
      rs.abortController.abort();
    }
  }

  /** Get current state summary for health check. */
  getStatus(): {
    running: number;
    completed: number;
    pendingRetries: number;
  } {
    return {
      running: this.state.running.size,
      completed: this.state.completed.size,
      pendingRetries: this.state.retryAttempts.size,
    };
  }
}
