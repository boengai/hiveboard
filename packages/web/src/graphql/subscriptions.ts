import { createClient } from 'graphql-sse'

export type ConnectionState = 'connected' | 'reconnecting' | 'error'

type ConnectionStateListener = (state: ConnectionState) => void

class ConnectionStateManager {
  private state: ConnectionState = 'connected'
  private listeners = new Set<ConnectionStateListener>()

  getState(): ConnectionState {
    return this.state
  }

  setState(state: ConnectionState) {
    if (this.state === state) return
    this.state = state
    this.listeners.forEach((fn) => { fn(state) })
  }

  subscribe(fn: ConnectionStateListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

export const connectionStateManager = new ConnectionStateManager()

export const sseClient = createClient({
  url: `${window.location.origin}/graphql`,
})

const BACKOFF_INTERVALS = [1000, 2000, 4000, 8000, 16000, 30000]

function getBackoffDelay(attempt: number): number {
  const index = Math.min(attempt, BACKOFF_INTERVALS.length - 1)
  return BACKOFF_INTERVALS[index] ?? BACKOFF_INTERVALS[0] ?? 1000
}

/**
 * Subscribe to a GraphQL subscription via SSE.
 * Auto-reconnects with exponential backoff (1s, 2s, 4s, 8s, 16s, max 30s).
 * Returns a dispose function to cancel the subscription.
 */
export function subscribe<T>(
  query: string,
  variables: Record<string, unknown>,
  onData: (data: T) => void,
): () => void {
  let disposed = false
  let attempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const run = async () => {
    try {
      const subscription = sseClient.iterate({ query, variables })
      for await (const result of subscription) {
        if (disposed) break
        // Successful data means we are connected
        if (attempt > 0 || connectionStateManager.getState() !== 'connected') {
          connectionStateManager.setState('connected')
        }
        attempt = 0
        if (result.data) onData(result.data as T)
      }
    } catch (err) {
      if (disposed) return
      console.error('Subscription error:', err)
      connectionStateManager.setState('error')
      scheduleReconnect()
    }

    // Iterable ended without error (server closed cleanly) — reconnect too
    if (!disposed) {
      scheduleReconnect()
    }
  }

  const scheduleReconnect = () => {
    if (disposed) return
    const delay = getBackoffDelay(attempt)
    attempt++
    connectionStateManager.setState('reconnecting')
    reconnectTimer = setTimeout(() => {
      if (!disposed) run()
    }, delay)
  }

  run()

  return () => {
    disposed = true
    clearTimer()
  }
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
