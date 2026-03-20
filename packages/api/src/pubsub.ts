import { createPubSub } from 'graphql-yoga'

export const pubsub = createPubSub<{
  'TASK_UPDATED': [boardId: string, payload: Record<string, unknown>]
  'AGENT_LOG': [taskId: string, payload: Record<string, unknown>]
  'COMMENT_ADDED': [taskId: string, payload: Record<string, unknown>]
  'TASK_EVENT': [taskId: string, payload: Record<string, unknown>]
}>()
