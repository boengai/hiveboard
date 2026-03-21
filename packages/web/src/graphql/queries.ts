export const GET_BOARDS = /* GraphQL */ `
  query GetBoards {
    boards {
      id
      name
      createdAt
      createdBy {
        id
        username
        displayName
      }
      columns {
        id
        name
        position
        tasks {
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
        }
      }
    }
  }
`

export const GET_BOARD = /* GraphQL */ `
  query GetBoard($id: ID!) {
    board(id: $id) {
      id
      name
      createdAt
      createdBy {
        id
        username
        displayName
      }
      columns {
        id
        name
        position
        tasks {
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
        }
      }
    }
  }
`

export const GET_TASK = /* GraphQL */ `
  query GetTask($id: ID!) {
    task(id: $id) {
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
      comments {
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
  }
`

export const GET_TASK_TIMELINE = /* GraphQL */ `
  query GetTaskTimeline($taskId: ID!) {
    taskTimeline(taskId: $taskId) {
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

export const GET_COMMENTS = /* GraphQL */ `
  query GetComments($taskId: ID!) {
    comments(taskId: $taskId) {
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

export const GET_AGENT_RUNS = /* GraphQL */ `
  query GetAgentRuns($taskId: ID!) {
    agentRuns(taskId: $taskId) {
      id
      action
      status
      output
      error
      startedAt
      finishedAt
    }
  }
`

export const GET_ME = /* GraphQL */ `
  query GetMe {
    me {
      id
      username
      displayName
      role
    }
  }
`
