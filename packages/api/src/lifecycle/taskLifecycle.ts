import type { Database } from 'bun:sqlite'

import { db as defaultDb, generateId } from '../db'
import type { TaskRow } from '../orchestrator/orchestrator'
import { publishTaskUpdated, pubsub } from '../pubsub'
import {
  type BlockReason,
  IllegalLifecycleEdgeError,
  isAllowedEdge,
  isValidStatus,
  type TaskStatus,
} from './state-machine'
import { mapTaskRow } from './task-row'

export type LifecycleEvent = {
  /** Event type, e.g. `agent_succeeded`, `agent_blocked`, `time_box_expired`. */
  type: string
  /** Actor — usually `'SYSTEM'` or a user id. */
  actor: string
  /** Optional structured payload, JSON-stringified for storage. */
  data?: Record<string, unknown> | null
  /** Optional pre-generated id; one is generated if absent. */
  id?: string
}

export type TransitionInput = {
  taskId: string
  to: TaskStatus
  /**
   * Assert the pre-state. If given and the row's current `agent_status`
   * doesn't match, the transition throws (regardless of `force`).
   */
  from?: TaskStatus
  /**
   * Set/clear `block_reason`. Pass a value to set, `null` to clear.
   * Omit to leave unchanged. When transitioning *out* of `blocked`,
   * pass `null` explicitly.
   */
  blockReason?: BlockReason | null
  /**
   * Single primary lifecycle event recorded against this transition.
   * Inserted into `task_events` and published on `TASK_EVENT`.
   * Multi-event transitions: write secondary events via `extras` and
   * publish them yourself.
   */
  event?: LifecycleEvent
  /**
   * Additional SQL atomic with the status update. Receives the same
   * `Database` handle. Common uses: paired `UPDATE agent_runs ...`,
   * dynamic column updates that aren't part of the lifecycle proper.
   * Runs *after* the status update but *inside* the same transaction.
   */
  extras?: (db: Database) => void
  /**
   * Skip state-machine validation. Required for one-off transitions not
   * declared in `state-machine.ts`. Document the reason in a code
   * comment when you use this — the validation exists for a reason.
   */
  force?: boolean
  /**
   * Override the database handle. Defaults to the global `db` from `../db`.
   * Used by callers that already accept a `db` param for test isolation
   * (e.g. `continueFailedTaskDb`).
   */
  db?: Database
}

export type TransitionResult = {
  boardId: string
  fromStatus: TaskStatus
  toStatus: TaskStatus
}

type TaskRowSubset = {
  id: string
  board_id: string
  agent_status: string
  block_reason: string | null
}

/**
 * Atomic Task Lifecycle transition. Owns:
 *
 *   1. Validation of the `from -> to` edge against the documented state
 *      machine (`state-machine.ts`) — unless `force: true`.
 *   2. Update of `tasks.agent_status` (and `block_reason` when given) plus
 *      `updated_at = datetime('now')`.
 *   3. Optional `extras(db)` callback inside the same transaction.
 *   4. Optional `task_events` row for the primary lifecycle event.
 *   5. Post-commit publish on `TASK_UPDATED` (and `TASK_EVENT` if an event
 *      was written).
 *
 * Does NOT own:
 *   - `agent_runs.status` writes (caller does this in `extras` when needed).
 *   - Secondary `task_events` rows beyond the primary lifecycle event.
 *   - Cross-task fanout (e.g. dependent re-publishes).
 */
export function transition(input: TransitionInput): TransitionResult {
  const {
    taskId,
    to,
    from: assertFrom,
    blockReason,
    event,
    extras,
    force = false,
    db = defaultDb,
  } = input

  const current = db
    .query(
      'SELECT id, board_id, agent_status, block_reason FROM tasks WHERE id = ?',
    )
    .get(taskId) as TaskRowSubset | null

  if (!current) {
    throw new Error(`taskLifecycle.transition: no task with id ${taskId}`)
  }

  if (!isValidStatus(current.agent_status)) {
    throw new Error(
      `taskLifecycle.transition: task ${taskId} has unknown agent_status='${current.agent_status}'`,
    )
  }

  const fromStatus = current.agent_status as TaskStatus

  if (assertFrom && assertFrom !== fromStatus) {
    throw new Error(
      `taskLifecycle.transition: task ${taskId} expected from=${assertFrom} but is ${fromStatus}`,
    )
  }

  if (!force && !isAllowedEdge(fromStatus, to)) {
    throw new IllegalLifecycleEdgeError(taskId, fromStatus, to)
  }

  let eventInsertedId: string | null = null
  let eventInsertedData: string | null = null
  let eventCreatedAt: string | null = null

  db.transaction(() => {
    if (blockReason === undefined) {
      db.run(
        `UPDATE tasks SET agent_status = ?, updated_at = datetime('now') WHERE id = ?`,
        [to, taskId],
      )
    } else {
      db.run(
        `UPDATE tasks SET agent_status = ?, block_reason = ?, updated_at = datetime('now') WHERE id = ?`,
        [to, blockReason, taskId],
      )
    }

    if (extras) extras(db)

    if (event) {
      const id = event.id ?? generateId()
      const data =
        event.data === undefined || event.data === null
          ? null
          : JSON.stringify(event.data)
      db.run(
        'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
        [id, taskId, event.actor, event.type, data],
      )
      eventInsertedId = id
      eventInsertedData = data
    }
  })()

  const updatedRow = db
    .query('SELECT * FROM tasks WHERE id = ?')
    .get(taskId) as TaskRow | null
  if (!updatedRow) {
    throw new Error(
      `taskLifecycle.transition: task ${taskId} disappeared mid-transition`,
    )
  }
  publishTaskUpdated(
    updatedRow.board_id,
    mapTaskRow(updatedRow) as unknown as Record<string, unknown>,
  )

  if (event && eventInsertedId) {
    if (eventCreatedAt === null) {
      const evRow = db
        .query('SELECT created_at FROM task_events WHERE id = ?')
        .get(eventInsertedId) as { created_at: string } | null
      eventCreatedAt = evRow?.created_at ?? new Date().toISOString()
    }
    pubsub.publish('TASK_EVENT', taskId, {
      _actor: event.actor,
      createdAt: eventCreatedAt,
      data: eventInsertedData,
      id: eventInsertedId,
      isSystem: event.actor === 'SYSTEM',
      type: event.type,
    } as unknown as Record<string, unknown>)
  }

  return {
    boardId: updatedRow.board_id,
    fromStatus,
    toStatus: to,
  }
}
