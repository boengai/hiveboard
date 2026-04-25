/**
 * Canonical TaskRow → wire-format mapping. Used by the Task Lifecycle module
 * when publishing TASK_UPDATED, and by orchestrator/resolvers when they need
 * to publish task rows in the same shape.
 *
 * If you find yourself defining `function mapTask(row)` somewhere, import
 * `mapTaskRow` from here instead.
 */

import type { TaskRow } from '../orchestrator/orchestrator'

export function mapTaskRow(row: TaskRow) {
  return {
    ...row,
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
