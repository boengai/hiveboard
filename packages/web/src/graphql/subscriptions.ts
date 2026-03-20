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
