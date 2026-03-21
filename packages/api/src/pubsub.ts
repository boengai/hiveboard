import { createPubSub } from 'graphql-yoga'

export const pubsub = createPubSub<{
  TASK_UPDATED: [boardId: string, payload: Record<string, unknown>]
  AGENT_LOG: [taskId: string, payload: Record<string, unknown>]
  COMMENT_ADDED: [taskId: string, payload: Record<string, unknown>]
  TASK_EVENT: [taskId: string, payload: Record<string, unknown>]
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
