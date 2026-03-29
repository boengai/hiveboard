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
    this.listeners.forEach((fn) => {
      fn(state)
    })
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

// ---------------------------------------------------------------------------
// Visibility-based reconnect
// ---------------------------------------------------------------------------

type ReconnectCallback = () => void
const reconnectCallbacks = new Set<ReconnectCallback>()

// When the tab becomes visible again, force all subscriptions to drop
// their current (likely dead) connection and reconnect immediately.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      for (const cb of reconnectCallbacks) cb()
    }
  })
}

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

  let activeIterator: AsyncIterableIterator<unknown> | null = null

  // Called on tab visibility change — reset backoff and kill the (likely dead)
  // connection. The natural run() flow will call scheduleReconnect exactly once.
  const forceReconnect = () => {
    if (disposed) return
    // Clear any pending backoff timer so we don't get a second reconnect
    clearTimer()
    // Reset backoff so the next reconnect is immediate (1s)
    attempt = 0
    // Kill the active iterator — run() will exit the for-await and
    // hit the `if (!disposed) scheduleReconnect()` path exactly once
    if (activeIterator?.return) {
      activeIterator.return(undefined)
    }
  }
  reconnectCallbacks.add(forceReconnect)

  const run = async () => {
    try {
      const subscription = sseClient.iterate({ query, variables })
      activeIterator = subscription as AsyncIterableIterator<unknown>
      // Stream opened — mark as connected and reset backoff
      connectionStateManager.setState('connected')
      attempt = 0
      for await (const result of subscription) {
        if (disposed) break
        if (result.data) onData(result.data as T)
      }
    } catch (err) {
      if (disposed) return
      console.error('Subscription error:', err)
      connectionStateManager.setState('error')
    } finally {
      activeIterator = null
    }

    // Reconnect whether the iterable ended cleanly or via error
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
    reconnectCallbacks.delete(forceReconnect)
    // Close the SSE connection immediately instead of waiting for the next
    // data event to break the for-await loop.
    if (activeIterator?.return) {
      activeIterator.return(undefined)
    }
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
      targetBranch
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
      tags {
        id
        name
        color
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
