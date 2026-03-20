import { consola } from 'consola'
import { db, generateId } from '../db'
import { pubsub, publishAgentLog } from '../pubsub'
import type { Config } from '../config/schema'
import { runAgent } from '../agent/runner'
import type { WorkspaceManager } from '../workspace/manager'
import { GitHubClient, type ReviewComment } from '../github/client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskRow {
  id: string
  board_id: string
  column_id: string
  title: string
  body: string
  action: string | null
  target_repo: string | null
  pr_url: string | null
  agent_status: string
  retry_count: number
  created_at: string
  updated_at: string
}

interface RunState {
  taskId: string
  workspacePath: string
  retryAttempt: number
  startedAt: Date
  abortController: AbortController
  done: Promise<void>
  resolveDone: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapTask(row: TaskRow) {
  return {
    id: row.id,
    board_id: row.board_id,
    column_id: row.column_id,
    title: row.title,
    body: row.body,
    action: row.action,
    target_repo: row.target_repo,
    agent_status: row.agent_status,
    retry_count: row.retry_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // GraphQL-cased fields
    targetRepo: row.target_repo,
    agentStatus: row.agent_status.toUpperCase(),
    retryCount: row.retry_count,
  }
}

/**
 * Find the "In Progress" column ID for a board.
 * Looks for a column named "In Progress" (case-insensitive).
 * Falls back to the second column if found, or null.
 */
function findColumnId(boardId: string, preferredName: string): string | null {
  const row = db
    .query(
      `SELECT id FROM columns WHERE board_id = ? AND lower(name) = lower(?) ORDER BY position ASC LIMIT 1`
    )
    .get(boardId, preferredName) as { id: string } | null
  return row?.id ?? null
}

/**
 * Format an array of PR review comments into a readable string for the agent prompt.
 */
function formatReviewComments(comments: ReviewComment[]): string {
  const lines: string[] = ['## PR Review Comments', '']
  for (const comment of comments) {
    lines.push(`### Comment by @${comment.author}`)
    if (comment.path) {
      const location = comment.line != null ? `${comment.path}:${comment.line}` : comment.path
      lines.push(`File: \`${location}\``)
    }
    if (comment.diffHunk) {
      lines.push('```diff', comment.diffHunk, '```')
    }
    lines.push(comment.body, '')
  }
  return lines.join('\n').trim()
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
    private workspace: WorkspaceManager,
    private promptTemplate: string
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    consola.info(
      `Orchestrator started (poll every ${this.config.polling.interval_ms}ms, max ${this.config.agent.max_concurrent_agents} agents)`
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

    consola.info(`Shutting down... waiting for ${this.running.size} running agents`)

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
      consola.warn(`Shutdown timeout: ${this.running.size} agents still running`)
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
      const available = (this.config.agent.max_concurrent_agents ?? 5) - this.running.size
      if (available <= 0) {
        consola.debug(
          `Concurrency limit reached (${this.running.size}/${this.config.agent.max_concurrent_agents})`
        )
        return
      }

      const queued = db
        .query(
          `SELECT * FROM tasks WHERE agent_status = ? ORDER BY updated_at ASC LIMIT ?`
        )
        .all('queued', available) as TaskRow[]

      consola.debug(`Polled: ${queued.length} queued task(s), ${this.running.size} running`)

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

    try {
      // 1. UPDATE tasks SET agent_status = 'running'
      db.run(
        `UPDATE tasks SET agent_status = 'running', updated_at = datetime('now') WHERE id = ?`,
        [task.id]
      )

      // 2. INSERT task_events: agent_started
      const agentStartedEventId = generateId()
      db.run(
        'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
        [
          agentStartedEventId,
          task.id,
          'SYSTEM',
          'agent_started',
          JSON.stringify({ action: task.action, retry: task.retry_count }),
        ]
      )

      // 3. INSERT agent_runs: status='running'
      const runId = generateId()
      db.run(
        `INSERT INTO agent_runs (id, task_id, action, status, started_at) VALUES (?, ?, ?, 'running', datetime('now'))`,
        [runId, task.id, task.action ?? '']
      )

      // 4. Move to "In Progress" (skip for plan/research)
      if (task.action !== 'plan' && task.action !== 'research') {
        const inProgressColId = findColumnId(task.board_id, 'In Progress')
        if (inProgressColId) {
          db.run(
            `UPDATE tasks SET column_id = ?, updated_at = datetime('now') WHERE id = ?`,
            [inProgressColId, task.id]
          )

          // 5. INSERT task_events: moved
          db.run(
            'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
            [
              generateId(),
              task.id,
              'SYSTEM',
              'moved',
              JSON.stringify({ to_column: 'In Progress' }),
            ]
          )
        }
      }

      // Fetch fresh task row after updates
      const updatedTask = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(task.id) as TaskRow

      // Publish TASK_UPDATED
      pubsub.publish(
        'TASK_UPDATED',
        updatedTask.board_id,
        mapTask(updatedTask) as unknown as Record<string, unknown>
      )

      // Publish the agent_started event
      const startedEvent = db
        .query('SELECT * FROM task_events WHERE id = ?')
        .get(agentStartedEventId) as { id: string; type: string; data: string | null; created_at: string; actor: string }
      if (startedEvent) {
        pubsub.publish('TASK_EVENT', task.id, {
          id: startedEvent.id,
          type: startedEvent.type,
          data: startedEvent.data,
          createdAt: startedEvent.created_at,
          isSystem: true,
          _actor: 'SYSTEM',
        } as unknown as Record<string, unknown>)
      }

      // 6. Create workspace
      const ws = await this.workspace.createForTask({
        id: task.id,
        title: task.title,
        targetRepo: task.target_repo,
      })

      // 7. Set up RunState
      const abortController = new AbortController()
      const retryAttempt = task.retry_count ?? 0

      let resolveDone!: () => void
      const done = new Promise<void>((resolve) => { resolveDone = resolve })

      const runState: RunState = {
        taskId: task.id,
        workspacePath: ws.path,
        retryAttempt,
        startedAt: new Date(),
        abortController,
        done,
        resolveDone,
      }

      this.running.set(task.id, runState)

      // 8. Fire runAgentAsync (not awaited)
      this.runAgentAsync(updatedTask, runId, runState)
    } catch (err) {
      consola.error(`Failed to dispatch task ${task.id}:`, err)
      this.running.delete(task.id)
      // Reset to queued so it can be retried
      db.run(
        `UPDATE tasks SET agent_status = 'queued', updated_at = datetime('now') WHERE id = ?`,
        [task.id]
      )
    }
  }

  // -------------------------------------------------------------------------
  // Agent execution
  // -------------------------------------------------------------------------

  private async runAgentAsync(task: TaskRow, runId: string, runState: RunState): Promise<void> {
    try {
      // For revise action, fetch PR review comments to include in the agent prompt
      let reviewComments: string | undefined
      if (task.action === 'revise' && task.pr_url) {
        try {
          const github = new GitHubClient()
          const comments = await github.fetchReviewComments(task.pr_url)
          if (comments.length > 0) {
            reviewComments = formatReviewComments(comments)
            consola.info(`Fetched ${comments.length} review comment(s) for task ${task.id}`)
          } else {
            consola.info(`No review comments found for task ${task.id} (${task.pr_url})`)
          }
        } catch (err) {
          consola.warn(`Failed to fetch review comments for task ${task.id}: ${err}`)
          // Continue without review comments rather than failing the whole run
        }
      }

      const result = await runAgent({
        task: {
          id: task.id,
          title: task.title,
          body: task.body,
          action: task.action,
          targetRepo: task.target_repo,
        },
        workspacePath: runState.workspacePath,
        promptTemplate: this.promptTemplate,
        config: this.config,
        retryAttempt: runState.retryAttempt,
        reviewComments,
        signal: runState.abortController.signal,
        onLog: (chunk) => {
          pubsub.publish('AGENT_LOG', task.id, {
            taskId: task.id,
            chunk,
            timestamp: new Date().toISOString(),
          } as unknown as Record<string, unknown>)
        },
      })

      await this.onComplete(task, runId, result)
    } catch (err) {
      consola.error(`Agent crashed for task ${task.id}:`, err)
      await this.onComplete(task, runId, {
        taskId: task.id,
        success: false,
        output: '',
        error: String(err),
      })
    } finally {
      this.running.delete(task.id)
      runState.resolveDone()
    }
  }

  // -------------------------------------------------------------------------
  // Completion
  // -------------------------------------------------------------------------

  private async onComplete(
    task: TaskRow,
    runId: string,
    result: { taskId: string; success: boolean; output: string; error?: string }
  ): Promise<void> {
    // Publish [DONE] marker so frontend knows stream ended
    publishAgentLog(task.id, {
      taskId: task.id,
      chunk: '[DONE]',
      timestamp: new Date().toISOString(),
    })

    if (result.success) {
      consola.info(`Task ${task.id} completed successfully`)

      // Parse PR URL from output if applicable
      let prUrl: string | null = null
      let prNumber: number | null = null
      if (task.action === 'implement' || task.action === 'implement-e2e' || task.action === 'revise') {
        const prMatch = result.output.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/)
        if (prMatch) {
          prUrl = prMatch[0] ?? null
          prNumber = prMatch[1] ? Number.parseInt(prMatch[1], 10) : null
        }
      }

      // Determine target column
      let targetColumnName: string | null = null
      if (task.action === 'plan') {
        targetColumnName = 'Todo'
      } else if (
        task.action === 'implement' ||
        task.action === 'implement-e2e' ||
        task.action === 'revise'
      ) {
        targetColumnName = 'Review'
      }
      // research stays in current column

      let targetColumnId: string | null = null
      if (targetColumnName) {
        targetColumnId = findColumnId(task.board_id, targetColumnName)
      }

      db.transaction(() => {
        // UPDATE tasks
        const setParts = [
          `agent_status = 'success'`,
          `agent_output = ?`,
          `updated_at = datetime('now')`,
        ]
        const setValues: (string | number | null)[] = [result.output]

        if (prUrl) {
          setParts.push('pr_url = ?', 'pr_number = ?')
          setValues.push(prUrl, prNumber)
        }

        if (targetColumnId) {
          setParts.push('column_id = ?')
          setValues.push(targetColumnId)
        }

        setValues.push(task.id)
        db.run(`UPDATE tasks SET ${setParts.join(', ')} WHERE id = ?`, setValues)

        // UPDATE agent_runs
        db.run(
          `UPDATE agent_runs SET status = 'success', output = ?, finished_at = datetime('now') WHERE id = ?`,
          [result.output, runId]
        )

        // INSERT event: agent_succeeded
        const eventId = generateId()
        db.run(
          'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
          [
            eventId,
            task.id,
            'SYSTEM',
            'agent_succeeded',
            JSON.stringify({ action: task.action, pr_url: prUrl }),
          ]
        )

        // INSERT event: moved (if column changed)
        if (targetColumnId && targetColumnName) {
          db.run(
            'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
            [
              generateId(),
              task.id,
              'SYSTEM',
              'moved',
              JSON.stringify({ to_column: targetColumnName }),
            ]
          )
        }
      })()

      const updatedTask = db.query('SELECT * FROM tasks WHERE id = ?').get(task.id) as TaskRow
      pubsub.publish(
        'TASK_UPDATED',
        updatedTask.board_id,
        mapTask(updatedTask) as unknown as Record<string, unknown>
      )

      // Publish agent_succeeded event
      pubsub.publish('TASK_EVENT', task.id, {
        type: 'agent_succeeded',
        data: JSON.stringify({ action: task.action, pr_url: prUrl }),
        createdAt: new Date().toISOString(),
        isSystem: true,
        _actor: 'SYSTEM',
      } as unknown as Record<string, unknown>)
    } else {
      consola.warn(`Task ${task.id} failed: ${result.error?.slice(0, 100)}`)

      db.transaction(() => {
        db.run(
          `UPDATE tasks SET agent_status = 'failed', agent_error = ?, updated_at = datetime('now') WHERE id = ?`,
          [result.error ?? null, task.id]
        )

        db.run(
          `UPDATE agent_runs SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?`,
          [result.error ?? null, runId]
        )

        db.run(
          'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
          [
            generateId(),
            task.id,
            'SYSTEM',
            'agent_failed',
            JSON.stringify({ action: task.action, error: result.error }),
          ]
        )
      })()

      const updatedTask = db.query('SELECT * FROM tasks WHERE id = ?').get(task.id) as TaskRow
      pubsub.publish(
        'TASK_UPDATED',
        updatedTask.board_id,
        mapTask(updatedTask) as unknown as Record<string, unknown>
      )

      pubsub.publish('TASK_EVENT', task.id, {
        type: 'agent_failed',
        data: JSON.stringify({ action: task.action, error: result.error }),
        createdAt: new Date().toISOString(),
        isSystem: true,
        _actor: 'SYSTEM',
      } as unknown as Record<string, unknown>)

      // Schedule retry with exponential backoff
      await this.scheduleRetry(task, result.error ?? 'Unknown error')
    }
  }

  // -------------------------------------------------------------------------
  // Retry
  // -------------------------------------------------------------------------

  private async scheduleRetry(task: TaskRow, _error: string): Promise<void> {
    const currentRetryCount = task.retry_count ?? 0
    const nextRetry = currentRetryCount + 1
    const baseDelay = 10_000 // 10 seconds
    const delay = Math.min(
      baseDelay * 2 ** currentRetryCount,
      this.config.agent.max_retry_backoff_ms
    )

    consola.info(`Scheduling retry #${nextRetry} for task ${task.id} in ${delay}ms`)

    const timer = setTimeout(() => {
      this.retryTimers.delete(task.id)
      // Re-queue the task
      db.run(
        `UPDATE tasks SET agent_status = 'queued', retry_count = ?, agent_error = NULL, updated_at = datetime('now') WHERE id = ?`,
        [nextRetry, task.id]
      )
      db.run(
        'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
        [
          generateId(),
          task.id,
          'SYSTEM',
          'retry_scheduled',
          JSON.stringify({ attempt: nextRetry, delay }),
        ]
      )

      const updatedTask = db.query('SELECT * FROM tasks WHERE id = ?').get(task.id) as TaskRow
      pubsub.publish(
        'TASK_UPDATED',
        updatedTask.board_id,
        mapTask(updatedTask) as unknown as Record<string, unknown>
      )
    }, delay)

    this.retryTimers.set(task.id, timer)
  }

  // -------------------------------------------------------------------------
  // External API
  // -------------------------------------------------------------------------

  /** Cancel a running agent for a task. */
  async cancelTask(taskId: string): Promise<void> {
    const runState = this.running.get(taskId)
    if (runState) {
      consola.info(`Cancelling agent for task ${taskId}`)
      runState.abortController.abort()

      // Wait for the agent process to finish (10s timeout)
      const timeout = 10_000
      await Promise.race([
        runState.done,
        Bun.sleep(timeout),
      ])

      // Update agent_runs to reflect cancellation
      db.run(
        `UPDATE agent_runs SET status = 'failed', error = 'Cancelled by user', finished_at = datetime('now') WHERE task_id = ? AND status = 'running'`,
        [taskId]
      )
    }

    // Also clear any pending retry
    const retryTimer = this.retryTimers.get(taskId)
    if (retryTimer) {
      clearTimeout(retryTimer)
      this.retryTimers.delete(taskId)
    }
  }

  /** Get current status summary. */
  getStatus(): { running: number; pendingRetries: number } {
    return {
      running: this.running.size,
      pendingRetries: this.retryTimers.size,
    }
  }
}
