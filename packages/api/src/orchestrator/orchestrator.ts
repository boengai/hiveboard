import type { Database } from 'bun:sqlite'
import { readFile, rename, unlink } from 'node:fs/promises'
import { consola } from 'consola'
import { GraphQLError } from 'graphql'
import { runAgent } from '../agent/runner'
import type { PreviousAttemptReplay } from '../agent/runner'
import { selectCheckpointsForReplay } from '../agent/checkpoint-replay'
import { countTurnsForRun, listCheckpointsForRun } from '../db/checkpoints'
import { listFailingRunsForAgentRun } from '../db/verification-runs'
import { subtasksPath } from '../workspace/agent-state'
import { transition as taskLifecycleTransition } from '../lifecycle'
import {
  applyFailure,
  applyQuestion,
  applySuccess,
  applyTimeout,
  decideOutcome,
  type OutcomeDeps,
} from './outcomes'
import { escapeMustacheSyntax } from './mustache-escape'
import { createSubtasksFromManifest, parseSubtasksManifest } from './subtasks'
import { formatVerificationFailureForAgent } from './verify'
import { parseRequiredSecrets, resolveSecretsForTask } from '../secrets/store'
import { publishTaskMissingSecretsChanged } from '../pubsub'

export { escapeMustacheSyntax } from './mustache-escape'

import type { Config } from '../config/schema'
import { db, generateId } from '../db'
import {
  listUndeliveredHumanMessages,
  markMessagesDelivered,
} from '../db/task-messages'
import type { GitHubClient, ReviewComment } from '../github/client'
import { getPlaybookByName } from '../playbooks'
import { publishAgentLog, publishTaskProgress, pubsub } from '../pubsub'
import { appendToInbox, readQuestion } from '../workspace/agent-state'
import type { WorkspaceManager } from '../workspace/manager'
import { watchProgress } from '../workspace/progress-watcher'
import { startSnapshotLoop } from './snapshot-loop'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskRow = {
  id: string
  board_id: string
  column_id: string
  title: string
  body: string
  action: string | null
  agent_instruction: string | null
  target_repo: string | null
  target_branch: string | null
  pr_url: string | null
  agent_status: string
  agent_output: string | null
  agent_error: string | null
  queue_after: string | null
  retry_count: number
  archived: number
  archived_at: string | null
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
  parent_task_id: string | null
  time_box_ms: number | null
  time_box_started_at: string | null
  block_reason: string | null
}

type RunState = {
  taskId: string
  workspacePath: string
  retryAttempt: number
  startedAt: Date
  abortController: AbortController
  done: Promise<void>
  resolveDone: () => void
  progressDispose?: () => void
  snapshotLoop?: { stop: () => Promise<void> }
  timeBoxTimer?: NodeJS.Timeout
  /** Abort reason set on time-box expiry; read in onComplete to decide BLOCKED vs SUCCESS/FAIL. */
  abortReason?: 'TIMEOUT' | 'REDIRECT' | 'CANCEL'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapTask(row: TaskRow) {
  return {
    ...row,
    // Internal refs for field resolvers (column, createdBy, updatedBy)
    _columnId: row.column_id,
    _createdBy: row.created_by,
    _updatedBy: row.updated_by,
    action: row.action,
    agentError: row.agent_error,
    agentInstruction: row.agent_instruction,
    agentOutput: row.agent_output,
    agentStatus: row.agent_status.toUpperCase(),
    archived: Boolean(row.archived),
    archivedAt: row.archived_at,
    blockReason: row.block_reason,
    createdAt: row.created_at,
    parentTaskId: row.parent_task_id,
    prUrl: row.pr_url,
    retryCount: row.retry_count,
    targetBranch: row.target_branch,
    targetRepo: row.target_repo,
    timeBoxMs: row.time_box_ms,
    timeBoxStartedAt: row.time_box_started_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Find the "In Progress" column ID for a board.
 * Looks for a column named "In Progress" (case-insensitive).
 * Falls back to the second column if found, or null.
 */
export function findColumnId(boardId: string, preferredName: string): string | null {
  const row = db
    .query(
      `SELECT id FROM columns WHERE board_id = ? AND lower(name) = lower(?) ORDER BY position ASC LIMIT 1`,
    )
    .get(boardId, preferredName) as { id: string } | null
  return row?.id ?? null
}

export function findColumnName(columnId: string): string | null {
  const row = db
    .query('SELECT name FROM columns WHERE id = ?')
    .get(columnId) as { name: string } | null
  return row?.name ?? null
}

/**
 * Format an array of PR review comments into a readable string for the agent prompt.
 * All user-provided fields are escaped to prevent Mustache/template injection.
 */
function formatReviewComments(comments: ReviewComment[]): string {
  const lines: string[] = ['## PR Review Comments', '']
  for (const comment of comments) {
    lines.push(`### Comment by @${escapeMustacheSyntax(comment.author)}`)
    if (comment.path) {
      const escapedPath = escapeMustacheSyntax(comment.path)
      const location =
        comment.line != null ? `${escapedPath}:${comment.line}` : escapedPath
      lines.push(`File: \`${location}\``)
    }
    if (comment.diffHunk) {
      lines.push('```diff', escapeMustacheSyntax(comment.diffHunk), '```')
    }
    lines.push(escapeMustacheSyntax(comment.body), '')
  }
  return lines.join('\n').trim()
}

/**
 * Pull the plan text out of a Claude CLI run. Handles both output formats:
 *   - Legacy `--output-format json`: a single JSON blob (array of content
 *     blocks or `{result: ...}` object).
 *   - `--output-format stream-json`: JSONL, with a terminal
 *     `{type:"result", result:"..."}` event carrying the final text.
 *
 * Returns '' when no plan text can be recovered — the caller is expected to
 * return null in that case so we never dump raw CLI bytes into `tasks.body`.
 */
export function parsePlanText(rawOutput: string): string {
  // Legacy single-blob JSON first.
  try {
    const parsed = JSON.parse(rawOutput)
    if (typeof parsed === 'string') return parsed
    if (Array.isArray(parsed)) {
      let t = ''
      for (const block of parsed) {
        if (block?.type === 'text' && typeof block.text === 'string') {
          t = block.text
        } else if (
          block?.type === 'result' &&
          typeof block.result === 'string'
        ) {
          t = block.result
        }
      }
      return t
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { result?: unknown }).result === 'string' &&
      (parsed as { is_error?: unknown }).is_error !== true
    ) {
      return (parsed as { result: string }).result
    }
  } catch {
    // Fall through to JSONL handling.
  }

  // stream-json: scan from the tail for the last {type:"result", result:"..."}.
  const lines = rawOutput.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim()
    if (!line) continue
    try {
      const evt = JSON.parse(line) as {
        type?: unknown
        result?: unknown
        is_error?: unknown
      }
      if (
        evt?.type === 'result' &&
        evt.is_error !== true &&
        typeof evt.result === 'string'
      ) {
        return evt.result
      }
    } catch {
      // Skip lines that aren't JSON (e.g. stderr-interleaved garbage).
    }
  }

  return ''
}

/**
 * Merge the Claude CLI plan text into the task body. Returns null when the
 * output contains no recoverable plan — the body is left untouched in that
 * case rather than corrupted with raw event stream bytes.
 */
export function extractPlanFromOutput(
  rawOutput: string,
  existingBody: string,
): string | null {
  const planText = parsePlanText(rawOutput).trim()
  if (!planText) {
    consola.warn(
      'extractPlanFromOutput: no plan text recovered from CLI output; leaving task body unchanged.',
    )
    return null
  }

  const planSection = `## Implementation Plan\n\n${planText}`
  const planRegex = /## Implementation Plan[\s\S]*$/
  if (planRegex.test(existingBody)) {
    return existingBody.replace(planRegex, planSection)
  }
  return existingBody
    ? `${existingBody.trimEnd()}\n\n${planSection}`
    : planSection
}

/**
 * Calculate retry delay with exponential backoff and jitter.
 *
 * Jitter prevents the "thundering herd" problem: when multiple agents fail
 * simultaneously (e.g. during an API outage), pure exponential backoff causes
 * them all to retry at the exact same instant, potentially overloading the
 * service again. Adding a random multiplier in [0.5, 1.5) spreads retries
 * across the backoff window.
 *
 * Formula: min(baseDelay * 2^retryCount * (0.5 + random()), maxBackoff)
 */
export function calculateRetryDelay(
  retryCount: number,
  maxBackoffMs: number,
  baseDelay = 10_000,
  random = Math.random,
): number {
  return Math.min(baseDelay * 2 ** retryCount * (0.5 + random()), maxBackoffMs)
}

/**
 * Pick the next N queued tasks that are eligible to spawn. Dep-aware by
 * default: excludes any task with at least one blocker whose `agent_status`
 * is not `success`. Tie-broken by (direct-blocker count DESC, updated_at ASC)
 * so tasks deeper in the dependency chain are prioritized.
 *
 * `legacyMode=true` falls back to the pre-Plan-E SELECT that ignores
 * dependencies entirely. Kept as an escape hatch behind
 * `config.scheduler.legacy_mode`.
 *
 * Exported for unit tests; production callers should use the `poll()` wrapper.
 */
export function selectSchedulableTasks(
  db: Database,
  opts: { limit: number; legacyMode: boolean },
): TaskRow[] {
  if (opts.legacyMode) {
    return db
      .query(
        `SELECT * FROM tasks
          WHERE agent_status = 'queued'
            AND action IS NOT NULL
            AND (queue_after IS NULL OR queue_after <= datetime('now'))
          ORDER BY updated_at ASC
          LIMIT ?`,
      )
      .all(opts.limit) as TaskRow[]
  }

  return db
    .query(
      `SELECT t.* FROM tasks t
        WHERE t.agent_status = 'queued'
          AND t.action IS NOT NULL
          AND (t.queue_after IS NULL OR t.queue_after <= datetime('now'))
          AND NOT EXISTS (
            SELECT 1 FROM task_dependencies d
              JOIN tasks b ON b.id = d.blocker_id
             WHERE d.task_id = t.id AND b.agent_status != 'success'
          )
        ORDER BY
          (SELECT COUNT(*) FROM task_dependencies d2 WHERE d2.task_id = t.id) DESC,
          t.updated_at ASC
        LIMIT ?`,
    )
    .all(opts.limit) as TaskRow[]
}

// ---------------------------------------------------------------------------
// Agent-run insert helper (exported for test)
// ---------------------------------------------------------------------------

export type InsertAgentRunInput = {
  db: Database
  runId: string
  taskId: string
  action: string
}

/**
 * Insert a row into `agent_runs` for a dispatch. Looks up the playbook
 * version if the action is `playbook:<name>` and records it as
 * `playbook_version_id` for audit. Missing playbooks degrade to NULL
 * (logged) — the dispatcher will separately reject the action at resolver
 * time, so this path is defensive.
 */
export function insertAgentRun(input: InsertAgentRunInput): void {
  let playbookVersionId: string | null = null
  if (input.action.startsWith('playbook:')) {
    const name = input.action.slice('playbook:'.length)
    const pb = getPlaybookByName(input.db, name)
    if (pb) {
      playbookVersionId = pb.currentVersion.id
    } else {
      consola.warn(
        `insertAgentRun: playbook "${name}" not found; recording NULL playbook_version_id`,
      )
    }
  }

  input.db.run(
    `INSERT INTO agent_runs (id, task_id, action, status, started_at, playbook_version_id) VALUES (?, ?, ?, 'running', datetime('now'), ?)`,
    [input.runId, input.taskId, input.action, playbookVersionId],
  )
}

/** Test-only re-export to avoid importing private class internals. */
export function insertAgentRunForTest(input: InsertAgentRunInput): void {
  insertAgentRun(input)
}

// ---------------------------------------------------------------------------
// Checkpoint replay builder (exported for test + orchestrator dispatch)
// ---------------------------------------------------------------------------

/**
 * Given a task id, find the most recent FAILED agent_run that occurred AFTER
 * the most recent SUCCESS run (if any), then build a PreviousAttemptReplay
 * bundle from its checkpoints.
 *
 * Rationale: only replay the immediate prior attempt in the current retry
 * cycle. If the task previously succeeded then later failed, we want the
 * recently-failed run, not some ancient failed run from before the success.
 */
export function buildPreviousAttemptReplay(
  db: Database,
  taskId: string,
): PreviousAttemptReplay | null {
  const latestSuccess = db
    .query(
      `SELECT id, started_at FROM agent_runs
       WHERE task_id = ? AND status = 'success'
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .get(taskId) as { id: string; started_at: string } | null

  const failedRow = (latestSuccess
    ? db
        .query(
          `SELECT id, error FROM agent_runs
           WHERE task_id = ? AND status IN ('failed', 'fail_verify')
             AND (started_at > ? OR (started_at = ? AND id > ?))
           ORDER BY started_at DESC
           LIMIT 1`,
        )
        .get(taskId, latestSuccess.started_at, latestSuccess.started_at, latestSuccess.id)
    : db
        .query(
          `SELECT id, error FROM agent_runs
           WHERE task_id = ? AND status IN ('failed', 'fail_verify')
           ORDER BY started_at DESC
           LIMIT 1`,
        )
        .get(taskId)) as { id: string; error: string | null } | null

  if (!failedRow) return null

  const all = listCheckpointsForRun(db, failedRow.id)
  if (all.length === 0) {
    return {
      checkpoints: [],
      failure_summary:
        failedRow.error ?? 'previous attempt failed (no checkpoints available)',
      turn_count: 0,
    }
  }
  const selected = selectCheckpointsForReplay(all)
  return {
    checkpoints: selected.map((cp) => ({
      kind: cp.kind,
      summary: cp.summary,
      turn: cp.turn,
    })),
    failure_summary: failedRow.error ?? 'previous attempt failed',
    turn_count: countTurnsForRun(db, failedRow.id),
  }
}

// ---------------------------------------------------------------------------
// Continue Failed Task
// ---------------------------------------------------------------------------

/**
 * Transitions a task from 'failed' → 'queued', incrementing retry_count.
 * Optionally appends an instruction to the existing agent_instruction.
 * Named `continueFailedTaskDb` to avoid collision with the resolver method.
 */
export function continueFailedTaskDb(
  db: Database,
  taskId: string,
  instruction?: string,
): void {
  const row = db
    .query(
      'SELECT agent_status, retry_count, agent_instruction FROM tasks WHERE id = ?',
    )
    .get(taskId) as
    | {
        agent_status: string
        retry_count: number
        agent_instruction: string | null
      }
    | null
  if (!row) {
    throw new GraphQLError('NOT_FOUND: Task not found', {
      extensions: { code: 'NOT_FOUND' },
    })
  }
  if (row.agent_status !== 'failed') {
    throw new GraphQLError('TASK_NOT_FAILED: Task is not in FAILED state', {
      extensions: { code: 'TASK_NOT_FAILED' },
    })
  }
  const nextRetry = (row.retry_count ?? 0) + 1
  let nextInstruction = row.agent_instruction
  if (instruction && instruction.trim().length > 0) {
    nextInstruction =
      nextInstruction && nextInstruction.trim().length > 0
        ? `${nextInstruction}, ${instruction.trim()}`
        : instruction.trim()
  }
  taskLifecycleTransition({
    db,
    extras: (txDb) => {
      txDb.run(
        `UPDATE tasks
           SET retry_count = ?,
               agent_instruction = ?,
               queue_after = datetime('now', '+2 seconds')
         WHERE id = ?`,
        [nextRetry, nextInstruction, taskId],
      )
    },
    from: 'failed',
    taskId,
    to: 'queued',
  })
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class Orchestrator {
  private running = new Map<string, RunState>()
  private pollTimer: Timer | null = null
  private sweepTimer: Timer | null = null
  private retryTimers = new Map<string, Timer>()
  private shutdownRequested = false

  constructor(
    private config: Config,
    private github: GitHubClient,
    private workspace: WorkspaceManager,
    private promptTemplate: string,
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    consola.info(
      `Orchestrator started (poll every ${this.config.polling.interval_ms}ms, max ${this.config.agent.max_concurrent_agents} agents)`,
    )
    this.schedulePoll()
    this.scheduleSweep()
  }

  async shutdown(): Promise<void> {
    this.shutdownRequested = true

    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }

    if (this.sweepTimer) {
      clearTimeout(this.sweepTimer)
      this.sweepTimer = null
    }

    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer)
    }
    this.retryTimers.clear()

    consola.info(
      `Shutting down... waiting for ${this.running.size} running agents`,
    )

    for (const rs of this.running.values()) {
      rs.abortController.abort()
    }

    // Wait for all agents to finish (30s timeout)
    const timeout = 30_000
    const start = Date.now()
    while (this.running.size > 0 && Date.now() - start < timeout) {
      await Bun.sleep(500)
    }

    if (this.running.size > 0) {
      consola.warn(
        `Shutdown timeout: ${this.running.size} agents still running`,
      )
    }

    consola.info('Orchestrator shut down')
  }

  // -------------------------------------------------------------------------
  // Polling
  // -------------------------------------------------------------------------

  private schedulePoll(): void {
    if (this.shutdownRequested) return
    this.pollTimer = setTimeout(async () => {
      await this.poll()
      this.schedulePoll()
    }, this.config.polling.interval_ms)
  }

  private scheduleSweep(): void {
    if (this.shutdownRequested) return
    if (this.workspace.ttlMs <= 0) return

    const SWEEP_INTERVAL = 3_600_000 // 1 hour
    this.sweepTimer = setTimeout(async () => {
      try {
        await this.workspace.sweepExpired()
      } catch (err) {
        consola.error('Workspace sweep failed:', err)
      }
      this.scheduleSweep()
    }, SWEEP_INTERVAL)
  }

  async poll(): Promise<void> {
    if (this.shutdownRequested) return

    try {
      // Refresh installation token every poll cycle so long-running agents
      // and subprocesses (gh, git) always have a valid GITHUB_TOKEN.
      await this.github.getAccessToken()
      // 1. Reconciliation: verify running agents still have agent_status='running' in DB
      for (const [taskId, runState] of this.running) {
        const task = db
          .query('SELECT agent_status FROM tasks WHERE id = ?')
          .get(taskId) as { agent_status: string } | null

        if (!task || task.agent_status !== 'running') {
          consola.warn(`Task ${taskId} no longer running in DB, aborting agent`)
          runState.abortController.abort()
          this.running.delete(taskId)
        }
      }

      // 2. Pick up queued tasks
      const available =
        (this.config.agent.max_concurrent_agents ?? 5) - this.running.size
      if (available <= 0) {
        consola.debug(
          `Concurrency limit reached (${this.running.size}/${this.config.agent.max_concurrent_agents})`,
        )
        return
      }

      const queued = selectSchedulableTasks(db, {
        legacyMode: this.config.scheduler.legacy_mode,
        limit: available,
      })

      consola.debug(
        `Polled: ${queued.length} queued task(s), ${this.running.size} running`,
      )

      for (const task of queued) {
        await this.dispatchTask(task)
      }
    } catch (err) {
      consola.error('Poll cycle failed:', err)
    }
  }

  // -------------------------------------------------------------------------
  // Dispatch
  // -------------------------------------------------------------------------

  async dispatchTask(task: TaskRow): Promise<void> {
    consola.info(`Dispatching task ${task.id} (action: ${task.action})`)

    let runId: string | null = null
    try {
      runId = generateId()
      const newRunId = runId
      taskLifecycleTransition({
        extras: (txDb) => {
          insertAgentRun({
            action: task.action ?? '',
            db: txDb,
            runId: newRunId,
            taskId: task.id,
          })

          if (task.action !== 'plan') {
            const inProgressColId = findColumnId(task.board_id, 'In Progress')
            if (inProgressColId) {
              const fromColumnName = findColumnName(task.column_id)
              txDb.run(
                `UPDATE tasks SET column_id = ?, updated_at = datetime('now') WHERE id = ?`,
                [inProgressColId, task.id],
              )

              txDb.run(
                'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
                [
                  generateId(),
                  task.id,
                  'SYSTEM',
                  'moved',
                  JSON.stringify({
                    from_column: fromColumnName,
                    to_column: 'In Progress',
                  }),
                ],
              )
            }
          }
        },
        taskId: task.id,
        to: 'running',
      })

      const updatedTask = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(task.id) as TaskRow

      // 5. Create workspace with fresh access token and git identity
      const accessToken = await this.github.getAccessToken()
      const gitIdentity = await this.github.getIdentity()
      const ws = await this.workspace.createForTask(
        {
          action: task.action,
          id: task.id,
          targetBranch: task.target_branch,
          targetRepo: task.target_repo,
          title: task.title,
        },
        accessToken,
        gitIdentity,
      )

      // 7. Set up RunState
      const abortController = new AbortController()
      const retryAttempt = task.retry_count ?? 0

      let resolveDone!: () => void
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve
      })

      const runState: RunState = {
        abortController,
        done,
        resolveDone,
        retryAttempt,
        startedAt: new Date(),
        taskId: task.id,
        workspacePath: ws.path,
      }

      this.running.set(task.id, runState)

      // Plan E: per-task time box. If set, abort the run after the budget
      // and stamp `time_box_started_at` so the UI can show a countdown.
      if (task.time_box_ms && task.time_box_ms > 0) {
        db.run(
          `UPDATE tasks SET time_box_started_at = datetime('now') WHERE id = ?`,
          [task.id],
        )
        runState.timeBoxTimer = setTimeout(() => {
          consola.warn(
            `Task ${task.id} exceeded time_box_ms=${task.time_box_ms} — aborting`,
          )
          runState.abortReason = 'TIMEOUT'
          runState.abortController.abort()
        }, task.time_box_ms)
      }

      // 8. Fire runAgentAsync (not awaited)
      this.runAgentAsync(updatedTask, runId, runState)
    } catch (err) {
      consola.error(`Failed to dispatch task ${task.id}:`, err)
      this.running.delete(task.id)
      const errMessage = err instanceof Error ? err.message : String(err)
      const orphanedRunId = runId
      taskLifecycleTransition({
        extras: (txDb) => {
          if (orphanedRunId) {
            txDb.run(
              `UPDATE agent_runs SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?`,
              [errMessage, orphanedRunId],
            )
          }
        },
        taskId: task.id,
        to: 'queued',
      })
    }
  }

  // -------------------------------------------------------------------------
  // Agent execution
  // -------------------------------------------------------------------------

  private async runAgentAsync(
    task: TaskRow,
    runId: string,
    runState: RunState,
  ): Promise<void> {
    try {
      // Detect auto-revise-from-verification mode: the task carries a pointer to
      // the agent_run whose verification failed. We load the failing runs, format
      // them for the prompt, then CLEAR the pointer so a subsequent human-driven
      // revise on the same task doesn't re-render the verification block.
      let verificationFailures: Array<{
        label: string
        command: string
        exit_code: number
        output: string
      }> = []

      const pendingRow = db
        .query(
          'SELECT pending_auto_revise_source_run_id FROM tasks WHERE id = ?',
        )
        .get(task.id) as {
        pending_auto_revise_source_run_id: string | null
      } | null

      if (pendingRow?.pending_auto_revise_source_run_id) {
        const sourceRunId = pendingRow.pending_auto_revise_source_run_id
        const failing = listFailingRunsForAgentRun(db, sourceRunId)
        if (failing.length > 0) {
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
          verificationFailures = fmt.verification_failures
        }
        // Clear the pointer regardless — whether or not we found failing runs,
        // this spawn is the attempt triggered by it.
        db.run(
          `UPDATE tasks SET pending_auto_revise_source_run_id = NULL, updated_at = datetime('now') WHERE id = ?`,
          [task.id],
        )
      }

      // For revise action, fetch PR review comments to include in the agent prompt
      let reviewComments: string | undefined
      if (task.action === 'revise' && task.pr_url) {
        try {
          const comments = await this.github.fetchReviewComments(task.pr_url)
          if (comments.length > 0) {
            reviewComments = formatReviewComments(comments)
            consola.info(
              `Fetched ${comments.length} review comment(s) for task ${task.id}`,
            )
          } else {
            consola.info(
              `No review comments found for task ${task.id} (${task.pr_url})`,
            )
          }
        } catch (err) {
          consola.warn(
            `Failed to fetch review comments for task ${task.id}: ${err}`,
          )
          // Continue without review comments rather than failing the whole run
        }
      }

      // Publish agent_started event right before spawning the agent process
      const agentStartedEventId = generateId()
      db.run(
        'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
        [
          agentStartedEventId,
          task.id,
          'SYSTEM',
          'agent_started',
          JSON.stringify({ action: task.action, retry: runState.retryAttempt }),
        ],
      )
      const startedEvent = db
        .query('SELECT * FROM task_events WHERE id = ?')
        .get(agentStartedEventId) as {
        id: string
        type: string
        data: string | null
        created_at: string
        actor: string
      }
      if (startedEvent) {
        pubsub.publish('TASK_EVENT', task.id, {
          _actor: 'SYSTEM',
          createdAt: startedEvent.created_at,
          data: startedEvent.data,
          id: startedEvent.id,
          isSystem: true,
          type: startedEvent.type,
        } as unknown as Record<string, unknown>)
      }

      // --- Plan D: progress watcher + snapshot loop ---
      if (this.config.progress?.enabled) {
        try {
          runState.progressDispose = watchProgress(
            this.config,
            task.id,
            (entry) => {
              publishTaskProgress(task.id, {
                agentRunId: runId,
                detail: entry.detail ?? null,
                label: entry.label,
                status: entry.status.toUpperCase() as
                  | 'IN_PROGRESS'
                  | 'DONE'
                  | 'FAILED',
                step: entry.step,
                taskId: task.id,
                total: entry.total,
                ts: entry.ts,
              })
            },
          )
        } catch (err) {
          consola.warn(
            `progress watcher setup failed for ${task.id}: ${(err as Error).message}`,
          )
        }

        try {
          runState.snapshotLoop = startSnapshotLoop({
            agentRunId: runId,
            config: this.config,
            db,
            taskId: task.id,
            workspacePath: runState.workspacePath,
          })
        } catch (err) {
          consola.warn(
            `snapshot loop setup failed for ${task.id}: ${(err as Error).message}`,
          )
        }
      }
      // --- end Plan D setup ---

      const gitIdentity = await this.github.getIdentity()

      const undeliveredMessages = listUndeliveredHumanMessages(db, task.id)
      const messagesForPrompt = undeliveredMessages
        .filter((m) => m.kind !== 'question') // questions are agent-authored anyway; safety
        .map((m) => ({
          body: escapeMustacheSyntax(m.body),
          created_at: m.createdAt,
          kind: m.kind as 'hint' | 'redirect' | 'answer',
        }))

      // Mark delivered before spawn. If spawn fails, the message is still preserved
      // in task_messages and the next spawn-time query will exclude it; the agent
      // won't see it. This is acceptable per spec (scratchpad captures context
      // across runs).
      if (undeliveredMessages.length > 0) {
        markMessagesDelivered(
          db,
          undeliveredMessages.map((m) => m.id),
        )
      }

      // For playbook dispatches, resolve the current version's
      // allowedToolsOverride so the spawned Claude CLI has its tool allowlist
      // clamped per the playbook. Missing playbooks degrade to undefined and
      // the runner falls back to the global config allow-list.
      let allowedToolsOverride: string[] | null | undefined
      if (task.action?.startsWith('playbook:')) {
        const name = task.action.slice('playbook:'.length)
        const pb = getPlaybookByName(db, name)
        allowedToolsOverride = pb
          ? pb.currentVersion.allowedToolsOverride
          : undefined
      }

      const previousAttemptReplay =
        runState.retryAttempt > 0
          ? buildPreviousAttemptReplay(db, task.id)
          : null

      // --- Pre-spawn secrets resolution gate (Plan H Task 13) ---
      const secretsResolution = resolveSecretsForTask(db, task.id)
      if (!secretsResolution.ok) {
        const missingNames = secretsResolution.missing
        const errMsg = `Missing required secrets: ${missingNames.join(', ')}`
        taskLifecycleTransition({
          extras: (txDb) => {
            txDb.run(
              `UPDATE tasks SET agent_error = ? WHERE id = ?`,
              [errMsg, task.id],
            )
            txDb.run(
              `UPDATE agent_runs SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?`,
              [errMsg, runId],
            )
          },
          taskId: task.id,
          to: 'missing_secrets',
        })
        publishTaskMissingSecretsChanged(task.id, missingNames)
        return
      }
      // --- end secrets gate ---

      // Build required-secrets list for prompt context (names + descriptions from board scope)
      const declaredNames = (() => {
        const taskSecretRow = db
          .query('SELECT required_secrets FROM tasks WHERE id = ?')
          .get(task.id) as { required_secrets: string | null } | null
        return parseRequiredSecrets(taskSecretRow?.required_secrets ?? null)
      })()
      const requiredSecretsForPrompt = declaredNames.map((name) => {
        const boardRow = db
          .query('SELECT description FROM board_secrets WHERE board_id = ? AND name = ?')
          .get(task.board_id, name) as { description: string | null } | null
        return { name, description: boardRow?.description ?? null }
      })

      const result = await runAgent({
        agentRunId: runId,
        allowedToolsOverride,
        config: this.config,
        db,
        gitIdentity,
        messages: messagesForPrompt,
        onLog: (chunk) => {
          pubsub.publish('AGENT_LOG', task.id, {
            chunk,
            taskId: task.id,
            timestamp: new Date().toISOString(),
          } as unknown as Record<string, unknown>)
        },
        previousAttemptReplay: previousAttemptReplay ?? undefined,
        promptTemplate: this.promptTemplate,
        retryAttempt: runState.retryAttempt,
        reviewComments,
        signal: runState.abortController.signal,
        task: {
          action: task.action,
          agentInstruction: task.agent_instruction,
          body: task.body,
          id: task.id,
          prUrl: task.pr_url,
          targetBranch: task.target_branch,
          targetRepo: task.target_repo,
          title: task.title,
        },
        tokenDir: this.github.getTokenDir(),
        verificationFailures,
        workspacePath: runState.workspacePath,
        secretsEnv: secretsResolution.env,
        secretValues: secretsResolution.values,
        requiredSecrets: requiredSecretsForPrompt,
      })

      // Plan D teardown: stop the progress watcher + snapshot loop as soon
      // as the agent exits, BEFORE `onComplete` runs `verifyAndGate`. The
      // verify phase can take minutes and shells out `bun run lint/tsc/test`
      // — keeping the 15s snapshot loop alive during that window wastes git
      // forks and risks racing with verify commands that might also touch
      // the workspace.
      await this.stopObservability(runState, task.id)
      await this.onComplete(task, runId, result)
    } catch (err) {
      consola.error(`Agent crashed for task ${task.id}:`, err)
      await this.stopObservability(runState, task.id)
      await this.onComplete(task, runId, {
        error: String(err),
        output: '',
        success: false,
        taskId: task.id,
      })
    } finally {
      // Defensive: if neither the happy nor the catch path executed the
      // teardown (e.g. an exception escaped stopObservability itself), do
      // it here. The helper is idempotent via null-out.
      await this.stopObservability(runState, task.id)

      this.running.delete(task.id)
      runState.resolveDone()
    }
  }

  /**
   * Stop the per-run progress watcher + snapshot loop. Idempotent — sets the
   * RunState fields to undefined after teardown so repeat calls are no-ops.
   */
  private async stopObservability(
    runState: RunState,
    taskId: string,
  ): Promise<void> {
    if (runState.timeBoxTimer) {
      clearTimeout(runState.timeBoxTimer)
      runState.timeBoxTimer = undefined
    }
    const ds = runState.progressDispose
    if (ds) {
      runState.progressDispose = undefined
      try {
        ds()
      } catch {
        /* ignore */
      }
    }
    const loop = runState.snapshotLoop
    if (loop) {
      runState.snapshotLoop = undefined
      try {
        await loop.stop()
      } catch (err) {
        consola.warn(`snapshot-loop stop ${taskId}: ${(err as Error).message}`)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Completion
  // -------------------------------------------------------------------------

  private async onComplete(
    task: TaskRow,
    runId: string,
    result: {
      taskId: string
      success: boolean
      output: string
      error?: string
    },
  ): Promise<void> {
    const runState = this.running.get(task.id)

    // Read the question file unconditionally so the picker has all the
    // signals it needs. (TIMEOUT short-circuits inside `decideOutcome` and
    // the question text is ignored — see CONTEXT.md → "Outcome".)
    const question =
      runState?.abortReason === 'TIMEOUT'
        ? ''
        : await readQuestion(this.config, task.id)

    const outcome = decideOutcome({
      abortReason: runState?.abortReason,
      question,
      result: { success: result.success },
    })

    // The [DONE] marker is published for every non-timeout exit.
    if (outcome.kind !== 'timeout') {
      publishAgentLog(task.id, {
        chunk: '[DONE]',
        taskId: task.id,
        timestamp: new Date().toISOString(),
      })
    }

    const deps: OutcomeDeps = {
      config: this.config,
      github: this.github,
      processSubtaskManifest: (t) => this.processSubtaskManifest(t),
      result,
      runId,
      scheduleRetry: (t, err) => this.scheduleRetry(t, err),
      task,
      workspacePath: runState?.workspacePath,
    }

    switch (outcome.kind) {
      case 'timeout':
        applyTimeout(deps)
        return
      case 'question':
        await applyQuestion(deps, outcome.question)
        return
      case 'success':
        consola.info(`Task ${task.id} completed successfully`)
        await applySuccess(deps)
        return
      case 'failure':
        await applyFailure(deps)
        return
    }
  }

  // -------------------------------------------------------------------------
  // Retry
  // -------------------------------------------------------------------------

  private async scheduleRetry(task: TaskRow, _error: string): Promise<void> {
    const currentRetryCount = task.retry_count ?? 0
    const nextRetry = currentRetryCount + 1
    // Jitter-aware backoff to avoid thundering herd when multiple agents fail together
    const delay = calculateRetryDelay(
      currentRetryCount,
      this.config.agent.max_retry_backoff_ms,
    )

    consola.info(
      `Scheduling retry #${nextRetry} for task ${task.id} in ${delay}ms`,
    )

    const timer = setTimeout(() => {
      this.retryTimers.delete(task.id)
      taskLifecycleTransition({
        event: {
          actor: 'SYSTEM',
          data: { attempt: nextRetry, delay },
          type: 'retry_scheduled',
        },
        extras: (txDb) => {
          txDb.run(
            `UPDATE tasks SET retry_count = ?, agent_error = NULL WHERE id = ?`,
            [nextRetry, task.id],
          )
        },
        from: 'failed',
        taskId: task.id,
        to: 'queued',
      })
    }, delay)

    this.retryTimers.set(task.id, timer)
  }

  /**
   * Inspect `$HIVEBOARD_SUBTASKS`; if present and valid, materialize the
   * declared children. On invalid manifest: rename to `subtasks.yaml.errored`
   * and log for human inspection. On DB-level failure: caught here; parent
   * flow continues.
   */
  private async processSubtaskManifest(task: TaskRow): Promise<void> {
    const path = subtasksPath(this.config, task.id)
    let yaml: string
    try {
      yaml = await readFile(path, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return
      consola.warn(
        `processSubtaskManifest ${task.id}: read failed — ${(err as Error).message}`,
      )
      return
    }

    const parsed = parseSubtasksManifest(yaml)
    if (parsed.kind === 'error') {
      consola.warn(
        `subtask manifest invalid for ${task.id}: ${parsed.errors.map((e) => e.code).join(',')}`,
      )
      db.run(
        'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
        [
          generateId(),
          task.id,
          'SYSTEM',
          'subtask_manifest_invalid',
          JSON.stringify({ errors: parsed.errors }),
        ],
      )
      try {
        await rename(path, `${path}.errored`)
      } catch {
        /* ignore */
      }
      return
    }

    let createdIds: string[] = []
    try {
      createdIds = createSubtasksFromManifest(
        db,
        task.id,
        parsed.manifest,
        task.created_by,
      )
    } catch (err) {
      consola.error(
        `createSubtasksFromManifest failed for ${task.id}: ${(err as Error).message}`,
      )
      db.run(
        'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
        [
          generateId(),
          task.id,
          'SYSTEM',
          'subtask_creation_failed',
          JSON.stringify({ message: (err as Error).message }),
        ],
      )
      try {
        await rename(path, `${path}.errored`)
      } catch {
        /* ignore */
      }
      return
    }

    // Success — clean up manifest and emit event
    try {
      await unlink(path)
    } catch {
      /* ignore */
    }
    db.run(
      'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
      [
        generateId(),
        task.id,
        'SYSTEM',
        'subtasks_spawned',
        JSON.stringify({ child_ids: createdIds, count: createdIds.length }),
      ],
    )

    for (const childId of createdIds) {
      const row = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(childId) as TaskRow | null
      if (row) {
        pubsub.publish(
          'TASK_UPDATED',
          row.board_id,
          mapTask(row) as unknown as Record<string, unknown>,
        )
      }
    }
  }

  // -------------------------------------------------------------------------
  // External API
  // -------------------------------------------------------------------------

  /**
   * React to a human-authored message for a task. Called by the GraphQL
   * resolvers (sendHint/sendRedirect) AFTER the task_messages row is
   * inserted, so the mutation can decide whether the message triggers an
   * immediate orchestrator action (redirect = abort+requeue; hint = inbox
   * append). 'answer' messages are handled by the answerQuestion mutation
   * directly and are a no-op here.
   */
  async dispatchHumanMessage(
    taskId: string,
    kind: 'hint' | 'redirect' | 'answer',
    body: string,
    messageId?: string,
  ): Promise<void> {
    if (kind === 'answer') return

    const row = db
      .query('SELECT agent_status FROM tasks WHERE id = ?')
      .get(taskId) as { agent_status: string } | null
    if (!row) return
    const isRunning = row.agent_status === 'running'

    if (kind === 'redirect') {
      const runState = this.running.get(taskId)
      if (runState) {
        consola.info(`Redirect received for task ${taskId} — aborting agent`)
        runState.abortReason = 'REDIRECT'
        runState.abortController.abort()
      }
      if (isRunning) {
        // Requeue with a short grace window so follow-up messages can batch.
        // Redirect is a human kick: reset verification state so the new run
        // starts fresh, not mid-retry.
        taskLifecycleTransition({
          extras: (txDb) => {
            txDb.run(
              `UPDATE tasks SET
                 queue_after = datetime('now', '+5 seconds'),
                 verify_attempt_count = 0,
                 pending_auto_revise_source_run_id = NULL
               WHERE id = ?`,
              [taskId],
            )
          },
          from: 'running',
          taskId,
          to: 'queued',
        })
      }
      return
    }

    // kind === 'hint'
    if (!isRunning) return
    await appendToInbox(this.config, taskId, `[hint] ${body}`)
    if (messageId) {
      // Mark only the specific row just inserted. Prevents a race where two
      // concurrent hints would each mark ALL undelivered hints delivered,
      // silently dropping the one that wasn't actually appended.
      db.run(
        `UPDATE task_messages SET delivered_at = datetime('now')
         WHERE id = ? AND delivered_at IS NULL`,
        [messageId],
      )
    }
  }

  /** Cancel a running agent for a task. */
  async cancelTask(taskId: string): Promise<void> {
    const runState = this.running.get(taskId)
    if (runState) {
      consola.info(`Cancelling agent for task ${taskId}`)
      runState.abortReason = 'CANCEL'
      runState.abortController.abort()

      if (runState.timeBoxTimer) {
        clearTimeout(runState.timeBoxTimer)
        runState.timeBoxTimer = undefined
      }

      // Wait for the agent process to finish (10s timeout)
      const timeout = 10_000
      await Promise.race([runState.done, Bun.sleep(timeout)])

      // Update agent_runs to reflect cancellation
      db.run(
        `UPDATE agent_runs SET status = 'failed', error = 'Cancelled by user', finished_at = datetime('now') WHERE task_id = ? AND status = 'running'`,
        [taskId],
      )
    }

    // Also clear any pending retry
    const retryTimer = this.retryTimers.get(taskId)
    if (retryTimer) {
      clearTimeout(retryTimer)
      this.retryTimers.delete(taskId)
    }
  }

  /**
   * Kill a running task outright: abort the agent, transition to FAILED with
   * `agent_error='killed by user'`. Does NOT schedule a retry. Safe no-op if
   * the task isn't running.
   */
  async killTask(taskId: string, reason = 'killed by user'): Promise<void> {
    const runState = this.running.get(taskId)
    if (runState) {
      runState.abortReason = 'CANCEL'
      runState.abortController.abort()
      if (runState.timeBoxTimer) {
        clearTimeout(runState.timeBoxTimer)
        runState.timeBoxTimer = undefined
      }
      await Promise.race([runState.done, Bun.sleep(10_000)])
    }
    taskLifecycleTransition({
      blockReason: null,
      extras: (txDb) => {
        txDb.run(
          `UPDATE tasks SET agent_error = ? WHERE id = ?`,
          [reason, taskId],
        )
        txDb.run(
          `UPDATE agent_runs SET status = 'failed', error = ?, finished_at = datetime('now')
            WHERE task_id = ? AND status = 'running'`,
          [reason, taskId],
        )
      },
      taskId,
      to: 'failed',
    })
  }

  /** Get current status summary. */
  getStatus(): { running: number; pendingRetries: number } {
    return {
      pendingRetries: this.retryTimers.size,
      running: this.running.size,
    }
  }

  /**
   * @internal Integration-test hook for the verify-gate path.
   * Allows tests to call onComplete directly without going through poll().
   * Exposes the private onComplete so tests can seed a RunState and invoke it.
   */
  _onCompleteForTest(
    task: Parameters<typeof this.onComplete>[0],
    runId: string,
    result: Parameters<typeof this.onComplete>[2],
  ): Promise<void> {
    return this.onComplete(task, runId, result)
  }
}
