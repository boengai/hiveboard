/**
 * Task Lifecycle state machine.
 *
 * Allowed edges per `docs/architecture.md` §4. The Task Lifecycle module
 * (`taskLifecycle.transition`) consults this table and rejects edges not
 * listed here unless the caller passes `force: true`.
 *
 * See `CONTEXT.md` for the role of this module in the codebase.
 */

export type TaskStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'blocked'
  | 'missing_secrets'

export type BlockReason =
  | 'QUESTION'
  | 'TIMEOUT'
  | 'DEPENDENCY_FAILED'
  | 'NO_PR_CREATED'

const ALL_STATUSES: readonly TaskStatus[] = [
  'idle',
  'queued',
  'running',
  'success',
  'failed',
  'blocked',
  'missing_secrets',
]

/**
 * Map of allowed `from -> to` edges. An entry of `to` reachable from `from`
 * means the transition is legal under the documented state machine.
 *
 * Notes:
 * - `* -> idle` is allowed from any non-terminal state to support
 *   `cancelAgent` and similar reset paths.
 * - `idle -> idle` is allowed (no-op idempotency) to keep cancel paths
 *   safe to call twice.
 * - `success -> queued` is the user-driven re-run edge: the AgentPanel
 *   keeps Plan/Implement/Revise/playbook actions available on a SUCCESS
 *   task (until it is moved to Done). Any other exit from `success`
 *   requires task delete or `force: true`.
 */
const ALLOWED: Readonly<Record<TaskStatus, ReadonlySet<TaskStatus>>> = {
  blocked: new Set<TaskStatus>(['queued', 'failed', 'idle']),
  failed: new Set<TaskStatus>(['queued', 'idle', 'failed']),
  idle: new Set<TaskStatus>(['queued', 'idle', 'blocked', 'failed']),
  missing_secrets: new Set<TaskStatus>(['queued', 'idle', 'blocked', 'failed']),
  queued: new Set<TaskStatus>([
    'running',
    'missing_secrets',
    'idle',
    'queued',
    'blocked',
    'failed',
  ]),
  running: new Set<TaskStatus>([
    'success',
    'failed',
    'blocked',
    'queued',
    'idle',
  ]),
  success: new Set<TaskStatus>(['queued']),
}

export function isValidStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && ALL_STATUSES.includes(value as TaskStatus)
}

export function isAllowedEdge(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED[from]?.has(to) ?? false
}

export class IllegalLifecycleEdgeError extends Error {
  readonly from: TaskStatus
  readonly to: TaskStatus
  readonly taskId: string
  constructor(taskId: string, from: TaskStatus, to: TaskStatus) {
    super(
      `Illegal task lifecycle edge for ${taskId}: ${from} -> ${to}. ` +
        `If this edge is intentional, pass { force: true } and document why.`,
    )
    this.taskId = taskId
    this.from = from
    this.to = to
  }
}
