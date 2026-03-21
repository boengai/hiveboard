export const CREATE_TASK = /* GraphQL */ `
  mutation CreateTask($input: CreateTaskInput!) {
    createTask(input: $input) {
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

export const UPDATE_TASK = /* GraphQL */ `
  mutation UpdateTask($id: ID!, $input: UpdateTaskInput!) {
    updateTask(id: $id, input: $input) {
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


export const MOVE_TASK = /* GraphQL */ `
  mutation MoveTask($id: ID!, $columnId: ID!, $position: Float!) {
    moveTask(id: $id, columnId: $columnId, position: $position) {
      id
      position
      column {
        id
        name
      }
    }
  }
`

export const ARCHIVE_TASK = /* GraphQL */ `
  mutation ArchiveTask($id: ID!) {
    archiveTask(id: $id) {
      id
      archived
      archivedAt
    }
  }
`

export const UNARCHIVE_TASK = /* GraphQL */ `
  mutation UnarchiveTask($id: ID!) {
    unarchiveTask(id: $id) {
      id
      archived
      archivedAt
    }
  }
`

export const ADD_COMMENT = /* GraphQL */ `
  mutation AddComment($taskId: ID!, $body: String!, $parentId: ID) {
    addComment(taskId: $taskId, body: $body, parentId: $parentId) {
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

export const UPDATE_COMMENT = /* GraphQL */ `
  mutation UpdateComment($id: ID!, $body: String!) {
    updateComment(id: $id, body: $body) {
      id
      body
      updatedAt
    }
  }
`

export const DELETE_COMMENT = /* GraphQL */ `
  mutation DeleteComment($id: ID!) {
    deleteComment(id: $id)
  }
`

export const DISPATCH_AGENT = /* GraphQL */ `
  mutation DispatchAgent($taskId: ID!, $action: String!) {
    dispatchAgent(taskId: $taskId, action: $action) {
      id
      agentStatus
      action
    }
  }
`

export const CANCEL_AGENT = /* GraphQL */ `
  mutation CancelAgent($taskId: ID!) {
    cancelAgent(taskId: $taskId) {
      id
      agentStatus
    }
  }
`
