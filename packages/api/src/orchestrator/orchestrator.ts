import type { Database } from 'bun:sqlite'
import { readFile, rename, unlink } from 'node:fs/promises'
import { consola } from 'consola'
import { GraphQLError } from 'graphql'
import { runAgent } from '../agent/runner'
import { transition as taskLifecycleTransition } from '../lifecycle'
import { publishTaskMissingSecretsChanged } from '../pubsub'
import { subtasksPath } from '../workspace/agent-state'
import { dispatchHumanMessage } from './human-messages'
import {
  applyFailure,
  applyQuestion,
  applySuccess,
  applyTimeout,
  decideOutcome,
  type OutcomeDeps,
} from './outcomes'
import { plan as prespawnPlan, type SpawnPlan } from './prespawn'
import { createSubtasksFromManifest, parseSubtasksManifest } from './subtasks'
import { findColumnId, findColumnName } from './columns'
import { calculateRetryDelay } from './retry-policy'

export { escapeMustacheSyntax } from './mustache-escape'

import type { Config } from '../config/schema'
import { db, generateId } from '../db'
import { markMessagesDelivered } from '../db/task-messages'
import type { GitHubClient } from '../github/client'
import { getPlaybookByName } from '../playbooks'
import { publishAgentLog, publishTaskProgress, pubsub } from '../pubsub'
import { readQuestion } from '../workspace/agent-state'
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
  /** The pre-spawn plan computed before dispatch; carried into runAgentAsync. */
  spawnPlan: SpawnPlan
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
    .get(taskId) as {
    agent_status: string
    retry_count: number
    agent_instruction: string | null
  } | null
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

    // 1. Secrets-gate-first pre-spawn pipeline.
    const result = await prespawnPlan(task, {
      db,
      github: this.github,
    })

    if (result.kind === 'missing_secrets') {
      const errMsg = `Missing required secrets: ${result.missing.join(', ')}`
      taskLifecycleTransition({
        taskId: task.id,
        to: 'missing_secrets',
        extras: (txDb) => {
          txDb.run(`UPDATE tasks SET agent_error = ? WHERE id = ?`, [errMsg, task.id])
        },
      })
      publishTaskMissingSecretsChanged(task.id, result.missing)
      return
    }

    const spawnPlan = result.plan
    const runId = generateId()
    const agentStartedEventId = generateId()

    try {
      // 2. Atomic commit: RUNNING transition + run insert + column move +
      //    delivered_at writes + cleared auto-revise pointer + agent_started event.
      taskLifecycleTransition({
        taskId: task.id,
        to: 'running',
        extras: (txDb) => {
          insertAgentRun({
            action: task.action ?? '',
            db: txDb,
            runId,
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
                  JSON.stringify({ from_column: fromColumnName, to_column: 'In Progress' }),
                ],
              )
            }
          }

          if (spawnPlan.commits.deliveredMessageIds.length > 0) {
            markMessagesDelivered(txDb, spawnPlan.commits.deliveredMessageIds)
          }

          if (spawnPlan.commits.clearPendingAutoReviseFor) {
            txDb.run(
              `UPDATE tasks SET pending_auto_revise_source_run_id = NULL, updated_at = datetime('now') WHERE id = ?`,
              [spawnPlan.commits.clearPendingAutoReviseFor],
            )
          }

          // agent_started event — inserted in the same tx as the RUNNING transition.
          txDb.run(
            'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
            [
              agentStartedEventId,
              task.id,
              'SYSTEM',
              'agent_started',
              JSON.stringify({ action: task.action, retry: spawnPlan.retryAttempt }),
            ],
          )
        },
      })

      const updatedTask = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(task.id) as TaskRow

      // 3. Workspace creation post-commit.
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

      // 4. RunState assembly + time-box arming.
      const abortController = new AbortController()
      let resolveDone!: () => void
      const done = new Promise<void>((resolve) => { resolveDone = resolve })

      const runState: RunState = {
        abortController,
        done,
        resolveDone,
        retryAttempt: spawnPlan.retryAttempt,
        startedAt: new Date(),
        taskId: task.id,
        workspacePath: ws.path,
        spawnPlan,
      }

      this.running.set(task.id, runState)

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

      // 5. Fire runAgentAsync (not awaited).
      this.runAgentAsync(updatedTask, runId, runState, gitIdentity, agentStartedEventId)
    } catch (err) {
      consola.error(`Failed to dispatch task ${task.id}:`, err)
      this.running.delete(task.id)
      const errMessage = err instanceof Error ? err.message : String(err)
      // Note: agent_runs row was inserted inside the lifecycle tx above; if that
      // tx succeeded but spawn setup later threw, we mark the run failed and
      // requeue. If the tx itself failed, the run row never existed.
      taskLifecycleTransition({
        taskId: task.id,
        to: 'queued',
        extras: (txDb) => {
          txDb.run(
            `UPDATE agent_runs SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?`,
            [errMessage, runId],
          )
          // The agent_started event was inserted in the prior lifecycle tx
          // (which committed). Spawn setup failed before runAgent could be
          // called, so we delete the orphan event here to keep the timeline
          // honest. If the prior tx itself rolled back, this DELETE is a no-op.
          txDb.run(`DELETE FROM task_events WHERE id = ?`, [agentStartedEventId])
        },
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
    gitIdentity: { name: string; email: string },
    agentStartedEventId: string,
  ): Promise<void> {
    try {
      const spawnPlan = runState.spawnPlan

      // Re-publish the agent_started event we already inserted in the dispatch tx.
      // The tx is the source of truth for the row; we look it up by id (deterministic).
      const startedEvent = db
        .query(
          'SELECT id, type, data, created_at, actor FROM task_events WHERE id = ?',
        )
        .get(agentStartedEventId) as {
        id: string
        type: string
        data: string | null
        created_at: string
        actor: string
      } | null
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

      // Plan D: progress watcher + snapshot loop.
      if (this.config.progress?.enabled) {
        try {
          runState.progressDispose = watchProgress(this.config, task.id, (entry) => {
            publishTaskProgress(task.id, {
              agentRunId: runId,
              detail: entry.detail ?? null,
              label: entry.label,
              status: entry.status.toUpperCase() as 'IN_PROGRESS' | 'DONE' | 'FAILED',
              step: entry.step,
              taskId: task.id,
              total: entry.total,
              ts: entry.ts,
            })
          })
        } catch (err) {
          consola.warn(`progress watcher setup failed for ${task.id}: ${(err as Error).message}`)
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
          consola.warn(`snapshot loop setup failed for ${task.id}: ${(err as Error).message}`)
        }
      }

      const result = await runAgent({
        agentRunId: runId,
        allowedToolsOverride: spawnPlan.allowedToolsOverride,
        config: this.config,
        db,
        gitIdentity,
        messages: spawnPlan.messages,
        onLog: (chunk) => {
          pubsub.publish('AGENT_LOG', task.id, {
            chunk,
            taskId: task.id,
            timestamp: new Date().toISOString(),
          } as unknown as Record<string, unknown>)
        },
        previousAttemptReplay: spawnPlan.previousAttemptReplay,
        promptTemplate: this.promptTemplate,
        requiredSecrets: spawnPlan.requiredSecrets,
        retryAttempt: spawnPlan.retryAttempt,
        reviewComments: spawnPlan.reviewComments,
        secretsEnv: spawnPlan.secretsEnv,
        secretValues: spawnPlan.secretValues,
        signal: runState.abortController.signal,
        task: spawnPlan.task,
        tokenDir: this.github.getTokenDir(),
        verificationFailures: spawnPlan.verificationFailures,
        workspacePath: runState.workspacePath,
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

  dispatchHumanMessage(
    taskId: string,
    kind: 'hint' | 'redirect' | 'answer',
    body: string,
    messageId?: string,
  ): Promise<void> {
    return dispatchHumanMessage(
      { config: this.config, running: this.running },
      taskId,
      kind,
      body,
      messageId,
    )
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
        txDb.run(`UPDATE tasks SET agent_error = ? WHERE id = ?`, [
          reason,
          taskId,
        ])
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
