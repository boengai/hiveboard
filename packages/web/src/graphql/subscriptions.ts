import { createClient } from 'graphql-sse'

export const sseClient = createClient({
  url: '/graphql',
})

/**
 * Subscribe to a GraphQL subscription via SSE.
 * Returns a dispose function to cancel the subscription.
 */
export function subscribe<T>(
  query: string,
  variables: Record<string, unknown>,
  onData: (data: T) => void,
): () => void {
  let disposed = false
  const dispose = () => { disposed = true }

  ;(async () => {
    try {
      const subscription = sseClient.iterate({ query, variables })
      for await (const result of subscription) {
        if (disposed) break
        if (result.data) onData(result.data as T)
      }
    } catch (err) {
      if (!disposed) console.error('Subscription error:', err)
    }
  })()

  return dispose
}

export const TASK_UPDATED_SUBSCRIPTION = /* GraphQL */ `
  subscription TaskUpdated($boardId: ID!) {
    taskUpdated(boardId: $boardId) {
      id
      title
      body
      position
      action
      targetRepo
      agentStatus
      agentOutput
      agentError
      retryCount
      prUrl
      prNumber
      archived
      archivedAt
      createdAt
      updatedAt
      createdBy {
        id
        username
        displayName
      }
      updatedBy {
        id
        username
        displayName
      }
      column {
        id
        name
      }
    }
  }
`

export const AGENT_LOG_STREAM_SUBSCRIPTION = /* GraphQL */ `
  subscription AgentLogStream($taskId: ID!) {
    agentLogStream(taskId: $taskId) {
      taskId
      chunk
      timestamp
    }
  }
`

export const COMMENT_ADDED_SUBSCRIPTION = /* GraphQL */ `
  subscription CommentAdded($taskId: ID!) {
    commentAdded(taskId: $taskId) {
      id
      body
      parentId
      createdAt
      updatedAt
      createdBy {
        id
        username
        displayName
      }
      replies {
        id
        body
        parentId
        createdAt
        updatedAt
        createdBy {
          id
          username
          displayName
        }
      }
    }
  }
`

export const TASK_EVENT_ADDED_SUBSCRIPTION = /* GraphQL */ `
  subscription TaskEventAdded($taskId: ID!) {
    taskEventAdded(taskId: $taskId) {
      id
      type
      isSystem
      data
      createdAt
      actor {
        id
        username
        displayName
      }
    }
  }
`
