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

export type BlockReason = 'QUESTION' | 'TIMEOUT' | 'DEPENDENCY_FAILED'

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
 * - `success` is treated as terminal: no edges out except via task delete
 *   (which doesn't go through this module) or admin-style force.
 */
const ALLOWED: Readonly<Record<TaskStatus, ReadonlySet<TaskStatus>>> = {
  idle: new Set<TaskStatus>(['queued', 'idle', 'blocked', 'failed']),
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
    'missing_secrets',
  ]),
  blocked: new Set<TaskStatus>(['queued', 'failed', 'idle']),
  failed: new Set<TaskStatus>(['queued', 'idle', 'failed']),
  missing_secrets: new Set<TaskStatus>([
    'queued',
    'idle',
    'blocked',
    'failed',
  ]),
  success: new Set<TaskStatus>([]),
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
