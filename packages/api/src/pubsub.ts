import { createPubSub } from 'graphql-yoga'

export const pubsub = createPubSub<{
  TASK_UPDATED: [boardId: string, payload: Record<string, unknown>]
  AGENT_LOG: [taskId: string, payload: Record<string, unknown>]
  COMMENT_ADDED: [taskId: string, payload: Record<string, unknown>]
  COMMENT_UPDATED: [taskId: string, payload: Record<string, unknown>]
  TASK_EVENT: [taskId: string, payload: Record<string, unknown>]
  SCRATCHPAD_UPDATED: [taskId: string, payload: Record<string, unknown>]
  TASK_MESSAGE: [taskId: string, payload: Record<string, unknown>]
  VERIFICATION_RUN: [taskId: string, payload: Record<string, unknown>]
  WORKSPACE_SNAPSHOT: [taskId: string, payload: Record<string, unknown>]
  TASK_PROGRESS: [taskId: string, payload: Record<string, unknown>]
  AGENT_CHECKPOINT: [taskId: string, payload: Record<string, unknown>]
  TASK_MISSING_SECRETS_CHANGED: [taskId: string, payload: Record<string, unknown>]
}>()

export function publishTaskUpdated(boardId: string, task: unknown) {
  pubsub.publish('TASK_UPDATED', boardId, task as Record<string, unknown>)
}

export function publishAgentLog(
  taskId: string,
  chunk: { taskId: string; chunk: string; timestamp: string },
) {
  pubsub.publish(
    'AGENT_LOG',
    taskId,
    chunk as unknown as Record<string, unknown>,
  )
}

export function publishCommentAdded(taskId: string, comment: unknown) {
  pubsub.publish('COMMENT_ADDED', taskId, comment as Record<string, unknown>)
}

export function publishTaskEvent(taskId: string, event: unknown) {
  pubsub.publish('TASK_EVENT', taskId, event as Record<string, unknown>)
}

export function publishScratchpadUpdated(
  taskId: string,
  payload: { taskId: string; content: string; updatedAt: string },
) {
  pubsub.publish(
    'SCRATCHPAD_UPDATED',
    taskId,
    payload as unknown as Record<string, unknown>,
  )
}

export function publishMessageAdded(taskId: string, message: unknown) {
  pubsub.publish('TASK_MESSAGE', taskId, message as Record<string, unknown>)
}

export function publishVerificationRun(
  taskId: string,
  run: {
    id: string
    taskId: string
    agentRunId: string | null
    command: string
    label: string
    exitCode: number
    output: string
    startedAt: string
    finishedAt: string
  },
): void {
  pubsub.publish(
    'VERIFICATION_RUN',
    taskId,
    run as unknown as Record<string, unknown>,
  )
}

export function publishWorkspaceSnapshot(
  taskId: string,
  snapshot: {
    id: string
    taskId: string
    agentRunId: string | null
    statSummary: string
    fileStatus: Array<{
      path: string
      status: string
      additions: number
      deletions: number
    }>
    hasPatch: boolean
    capturedAt: string
  },
): void {
  pubsub.publish(
    'WORKSPACE_SNAPSHOT',
    taskId,
    snapshot as unknown as Record<string, unknown>,
  )
}

export function publishTaskProgress(
  taskId: string,
  entry: {
    taskId: string
    agentRunId: string | null
    ts: string
    step: number
    total: number
    label: string
    detail: string | null
    status: 'IN_PROGRESS' | 'DONE' | 'FAILED'
  },
): void {
  pubsub.publish(
    'TASK_PROGRESS',
    taskId,
    entry as unknown as Record<string, unknown>,
  )
}

export function publishCheckpointAdded(
  taskId: string,
  payload: {
    id: string
    agentRunId: string
    taskId: string
    turn: number
    kind: string
    summary: string
    rawBytes: number
    occurredAt: string
  },
): void {
  pubsub.publish(
    'AGENT_CHECKPOINT',
    taskId,
    payload as unknown as Record<string, unknown>,
  )
}

export function publishTaskMissingSecretsChanged(
  taskId: string,
  missing: string[],
): void {
  pubsub.publish('TASK_MISSING_SECRETS_CHANGED', taskId, {
    taskId,
    missingSecrets: missing,
  })
}
