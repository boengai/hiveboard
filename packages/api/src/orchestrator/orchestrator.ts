import { consola } from 'consola'
import { runAgent } from '../agent/runner'
import type { Config } from '../config/schema'
import { db, generateId } from '../db'
import type { GitHubClient, ReviewComment } from '../github/client'
import { publishAgentLog, pubsub } from '../pubsub'
import type { WorkspaceManager } from '../workspace/manager'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TaskRow = {
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
}

type RunState = {
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
    ...row,
    // Internal refs for field resolvers (column, createdBy, updatedBy)
    _columnId: row.column_id,
    _createdBy: row.created_by,
    _updatedBy: row.updated_by,
    action: row.action ? row.action.toUpperCase() : null,
    agentError: row.agent_error,
    agentInstruction: row.agent_instruction,
    agentOutput: row.agent_output,
    agentStatus: row.agent_status.toUpperCase(),
    archived: Boolean(row.archived),
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    prUrl: row.pr_url,
    retryCount: row.retry_count,
    targetBranch: row.target_branch,
    targetRepo: row.target_repo,
    updatedAt: row.updated_at,
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
      `SELECT id FROM columns WHERE board_id = ? AND lower(name) = lower(?) ORDER BY position ASC LIMIT 1`,
    )
    .get(boardId, preferredName) as { id: string } | null
  return row?.id ?? null
}

function findColumnName(columnId: string): string | null {
  const row = db
    .query('SELECT name FROM columns WHERE id = ?')
    .get(columnId) as { name: string } | null
  return row?.name ?? null
}

/**
 * Escape Mustache/template delimiters in untrusted text so that user-provided
 * content (e.g. PR review comments from GitHub) is never interpreted as
 * Mustache tags or JS template-literal expressions when embedded in a prompt.
 *
 * - `{{` → `{ {`  (break the opening Mustache delimiter)
 * - `}}` → `} }`  (break the closing Mustache delimiter)
 * - `${` → `$ {`  (break JS template-literal expressions)
 */
export function escapeMustacheSyntax(text: string): string {
  return text
    .replace(/\{(?=\{)/g, '{ ')
    .replace(/\}(?=\})/g, '} ')
    .replace(/\$(?=\{)/g, '$ ')
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
 * Extract the plan text from Claude CLI JSON output and merge it into the task body.
 * Claude CLI with --print --output-format json returns a JSON array of content blocks.
 * We extract the final text response and append/replace the ## Implementation Plan section.
 */
function extractPlanFromOutput(
  rawOutput: string,
  existingBody: string,
): string | null {
  try {
    // Claude --print --output-format json outputs a JSON array of message blocks
    // The last text block from the assistant is the plan
    const parsed = JSON.parse(rawOutput)

    let planText = ''
    if (typeof parsed === 'string') {
      planText = parsed
    } else if (Array.isArray(parsed)) {
      // Find the last assistant text content
      for (const block of parsed) {
        if (block.type === 'text' && typeof block.text === 'string') {
          planText = block.text
        } else if (
          block.type === 'result' &&
          typeof block.result === 'string'
        ) {
          planText = block.result
        }
      }
    } else if (parsed?.result) {
      planText = String(parsed.result)
    }

    if (!planText.trim()) return null

    // Merge into existing body: replace ## Implementation Plan section if it exists
    const planSection = `## Implementation Plan\n\n${planText.trim()}`
    const planRegex = /## Implementation Plan[\s\S]*$/
    if (planRegex.test(existingBody)) {
      return existingBody.replace(planRegex, planSection)
    }
    return existingBody
      ? `${existingBody.trimEnd()}\n\n${planSection}`
      : planSection
  } catch {
    // Output wasn't valid JSON — use raw text as the plan
    consola.warn('Could not parse Claude CLI output as JSON, using raw text')
    const planSection = `## Implementation Plan\n\n${rawOutput.trim()}`
    const planRegex = /## Implementation Plan[\s\S]*$/
    if (planRegex.test(existingBody)) {
      return existingBody.replace(planRegex, planSection)
    }
    return existingBody
      ? `${existingBody.trimEnd()}\n\n${planSection}`
      : planSection
  }
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
  return Math.min(
    baseDelay * 2 ** retryCount * (0.5 + random()),
    maxBackoffMs,
  )
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

      const queued = db
        .query(
          `SELECT * FROM tasks WHERE agent_status = ? AND action IS NOT NULL AND (queue_after IS NULL OR queue_after <= datetime('now')) ORDER BY updated_at ASC LIMIT ?`,
        )
        .all('queued', available) as TaskRow[]

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
      // 1. UPDATE tasks SET agent_status = 'running'
      db.run(
        `UPDATE tasks SET agent_status = 'running', updated_at = datetime('now') WHERE id = ?`,
        [task.id],
      )

      // 2. INSERT agent_runs: status='running'
      runId = generateId()
      db.run(
        `INSERT INTO agent_runs (id, task_id, action, status, started_at) VALUES (?, ?, ?, 'running', datetime('now'))`,
        [runId, task.id, task.action ?? ''],
      )

      // 4. Move to "In Progress" (skip for plan)
      if (task.action !== 'plan') {
        const inProgressColId = findColumnId(task.board_id, 'In Progress')
        if (inProgressColId) {
          const fromColumnName = findColumnName(task.column_id)
          db.run(
            `UPDATE tasks SET column_id = ?, updated_at = datetime('now') WHERE id = ?`,
            [inProgressColId, task.id],
          )

          // 5. INSERT task_events: moved
          db.run(
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

      // Fetch fresh task row after updates
      const updatedTask = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(task.id) as TaskRow

      // Publish TASK_UPDATED
      pubsub.publish(
        'TASK_UPDATED',
        updatedTask.board_id,
        mapTask(updatedTask) as unknown as Record<string, unknown>,
      )

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

      // 8. Fire runAgentAsync (not awaited)
      this.runAgentAsync(updatedTask, runId, runState)
    } catch (err) {
      consola.error(`Failed to dispatch task ${task.id}:`, err)
      this.running.delete(task.id)
      // Mark the agent_runs row as failed so it doesn't remain orphaned
      if (runId) {
        db.run(
          `UPDATE agent_runs SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?`,
          [err instanceof Error ? err.message : String(err), runId],
        )
      }
      // Reset to queued so it can be retried
      db.run(
        `UPDATE tasks SET agent_status = 'queued', updated_at = datetime('now') WHERE id = ?`,
        [task.id],
      )
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

      const gitIdentity = await this.github.getIdentity()
      const result = await runAgent({
        config: this.config,
        gitIdentity,
        onLog: (chunk) => {
          pubsub.publish('AGENT_LOG', task.id, {
            chunk,
            taskId: task.id,
            timestamp: new Date().toISOString(),
          } as unknown as Record<string, unknown>)
        },
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
        workspacePath: runState.workspacePath,
      })

      await this.onComplete(task, runId, result)
    } catch (err) {
      consola.error(`Agent crashed for task ${task.id}:`, err)
      await this.onComplete(task, runId, {
        error: String(err),
        output: '',
        success: false,
        taskId: task.id,
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
    result: {
      taskId: string
      success: boolean
      output: string
      error?: string
    },
  ): Promise<void> {
    // Publish [DONE] marker so frontend knows stream ended
    publishAgentLog(task.id, {
      chunk: '[DONE]',
      taskId: task.id,
      timestamp: new Date().toISOString(),
    })

    if (result.success) {
      consola.info(`Task ${task.id} completed successfully`)

      // Parse PR URL from output if applicable
      let prUrl: string | null = null
      if (task.action === 'implement' || task.action === 'revise') {
        const prMatch = result.output.match(
          /https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/,
        )
        if (prMatch) {
          const prRepo = prMatch[1] // "owner/repo" from the URL
          if (task.target_repo && prRepo !== task.target_repo) {
            consola.warn(
              `PR URL ${prMatch[0]} does not belong to target repo ${task.target_repo} — ignoring`,
            )
          } else {
            prUrl = prMatch[0] ?? null
          }
        }
      }

      // Determine target column
      let targetColumnName: string | null = null
      if (task.action === 'plan') {
        targetColumnName = 'Todo'
      } else if (task.action === 'implement' || task.action === 'revise') {
        targetColumnName = 'Review'
      }
      // plan stays in current column

      let targetColumnId: string | null = null
      if (targetColumnName) {
        targetColumnId = findColumnId(task.board_id, targetColumnName)
      }

      // For plan actions, extract the plan text and update the task body
      let planBody: string | null = null
      if (task.action === 'plan' && result.output) {
        planBody = extractPlanFromOutput(result.output, task.body)
      }

      db.transaction(() => {
        // UPDATE tasks — clear action so the task returns to idle state
        const setParts = [
          `agent_status = 'success'`,
          `action = NULL`,
          `agent_output = ?`,
          `updated_at = datetime('now')`,
        ]
        const setValues: (string | number | null)[] = [result.output]

        if (planBody) {
          setParts.push('body = ?')
          setValues.push(planBody)
        }

        if (prUrl) {
          setParts.push('pr_url = ?')
          setValues.push(prUrl)
        }

        if (targetColumnId) {
          setParts.push('column_id = ?')
          setValues.push(targetColumnId)
        }

        setValues.push(task.id)
        db.run(
          `UPDATE tasks SET ${setParts.join(', ')} WHERE id = ?`,
          setValues,
        )

        // UPDATE agent_runs
        db.run(
          `UPDATE agent_runs SET status = 'success', output = ?, finished_at = datetime('now') WHERE id = ?`,
          [result.output, runId],
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
          ],
        )

        // INSERT event: moved (if column changed)
        if (targetColumnId && targetColumnName) {
          const fromColumnName = findColumnName(task.column_id)
          db.run(
            'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
            [
              generateId(),
              task.id,
              'SYSTEM',
              'moved',
              JSON.stringify({
                from_column: fromColumnName,
                to_column: targetColumnName,
              }),
            ],
          )
        }
      })()

      const updatedTask = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(task.id) as TaskRow
      pubsub.publish(
        'TASK_UPDATED',
        updatedTask.board_id,
        mapTask(updatedTask) as unknown as Record<string, unknown>,
      )

      // Publish agent_succeeded event
      pubsub.publish('TASK_EVENT', task.id, {
        _actor: 'SYSTEM',
        createdAt: new Date().toISOString(),
        data: JSON.stringify({ action: task.action, pr_url: prUrl }),
        isSystem: true,
        type: 'agent_succeeded',
      } as unknown as Record<string, unknown>)
    } else {
      consola.warn(`Task ${task.id} failed: ${result.error?.slice(0, 100)}`)

      db.transaction(() => {
        db.run(
          `UPDATE tasks SET agent_status = 'failed', agent_error = ?, updated_at = datetime('now') WHERE id = ?`,
          [result.error ?? null, task.id],
        )

        db.run(
          `UPDATE agent_runs SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?`,
          [result.error ?? null, runId],
        )

        db.run(
          'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
          [
            generateId(),
            task.id,
            'SYSTEM',
            'agent_failed',
            JSON.stringify({ action: task.action, error: result.error }),
          ],
        )
      })()

      const updatedTask = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(task.id) as TaskRow
      pubsub.publish(
        'TASK_UPDATED',
        updatedTask.board_id,
        mapTask(updatedTask) as unknown as Record<string, unknown>,
      )

      pubsub.publish('TASK_EVENT', task.id, {
        _actor: 'SYSTEM',
        createdAt: new Date().toISOString(),
        data: JSON.stringify({ action: task.action, error: result.error }),
        isSystem: true,
        type: 'agent_failed',
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
      // Re-queue the task
      db.run(
        `UPDATE tasks SET agent_status = 'queued', retry_count = ?, agent_error = NULL, updated_at = datetime('now') WHERE id = ?`,
        [nextRetry, task.id],
      )
      db.run(
        'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
        [
          generateId(),
          task.id,
          'SYSTEM',
          'retry_scheduled',
          JSON.stringify({ attempt: nextRetry, delay }),
        ],
      )

      const updatedTask = db
        .query('SELECT * FROM tasks WHERE id = ?')
        .get(task.id) as TaskRow
      pubsub.publish(
        'TASK_UPDATED',
        updatedTask.board_id,
        mapTask(updatedTask) as unknown as Record<string, unknown>,
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

  /** Get current status summary. */
  getStatus(): { running: number; pendingRetries: number } {
    return {
      pendingRetries: this.retryTimers.size,
      running: this.running.size,
    }
  }
}
