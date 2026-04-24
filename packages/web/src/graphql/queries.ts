import { PLAYBOOK_FIELDS } from './playbook-fragments'

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
      tags {
        id
        name
        color
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
          agentInstruction
          targetRepo
          targetBranch
          agentStatus
          retryCount
          prUrl
          verifyAttemptCount
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
          tags {
            id
            name
            color
          }
          blockReason
          blockers {
            id
            agentStatus
          }
          parentTask {
            id
            title
            tags {
              color
            }
          }
          missingSecrets
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
      tags {
        id
        name
        color
      }
      secrets {
        id
        name
        description
        createdBy {
          id
          username
          displayName
        }
        createdAt
        updatedAt
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
          agentInstruction
          targetRepo
          targetBranch
          agentStatus
          retryCount
          prUrl
          verifyAttemptCount
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
          blockReason
          blockers {
            id
            agentStatus
          }
          parentTask {
            id
            title
            tags {
              color
            }
          }
          missingSecrets
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
      agentInstruction
      targetRepo
      targetBranch
      agentStatus
      retryCount
      prUrl
      scratchpad
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
      messages {
        id
        taskId
        authorType
        kind
        body
        deliveredAt
        createdAt
        createdBy {
          id
          username
          displayName
        }
      }
      currentQuestion {
        id
        body
        createdAt
      }
      verificationRuns {
        id
        taskId
        agentRunId
        command
        label
        exitCode
        output
        startedAt
        finishedAt
      }
      workspaceSnapshots {
        id
        taskId
        agentRunId
        statSummary
        fileStatus {
          path
          status
          additions
          deletions
        }
        hasPatch
        capturedAt
      }
      verifyAttemptCount
      verifyCommandsOverride {
        label
        run
        timeoutMs
      }
      parentTask {
        id
        title
        agentStatus
      }
      subtasks {
        id
        title
        agentStatus
        blockReason
        action
        createdAt
      }
      blockers {
        id
        title
        agentStatus
        blockReason
      }
      dependents {
        id
        title
        agentStatus
        blockReason
      }
      blockReason
      requiredSecrets
      missingSecrets
      taskSecrets {
        id
        name
        createdBy {
          id
          username
          displayName
        }
        createdAt
        updatedAt
      }
      timeBoxMs
      timeBoxStartedAt
      timeBoxRemainingMs
      agentRuns {
        id
        action
        status
        turnCount
        checkpoints {
          id
          agentRunId
          turn
          kind
          summary
          rawBytes
          occurredAt
        }
        startedAt
        finishedAt
        error
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
      turnCount
      checkpoints {
        id
        turn
        kind
        summary
        rawBytes
        occurredAt
      }
    }
  }
`

export const GET_TASK_PROGRESS = /* GraphQL */ `
  query GetTaskProgress($taskId: ID!) {
    taskProgress(taskId: $taskId) {
      taskId
      agentRunId
      ts
      step
      total
      label
      detail
      status
    }
  }
`

export const GET_WORKSPACE_SNAPSHOT_PATCH = /* GraphQL */ `
  query GetWorkspaceSnapshotPatch($id: ID!) {
    workspaceSnapshotPatch(id: $id)
  }
`

export const GET_ME = /* GraphQL */ `
  query GetMe {
    me {
      id
      username
      displayName
      role
      githubId
      githubUsername
    }
  }
`

export const GET_AUTH_CONFIG = /* GraphQL */ `
  query GetAuthConfig {
    authConfig {
      githubOAuthClientId
      isLocal
    }
  }
`

export const GET_USERS = /* GraphQL */ `
  query GetUsers {
    users {
      id
      username
      displayName
      role
      githubId
      githubUsername
      revokedAt
      createdAt
    }
  }
`

export const GET_INVITATIONS = /* GraphQL */ `
  query GetInvitations {
    invitations {
      id
      token
      githubUsername
      createdAt
      expiresAt
      usedAt
      createdBy {
        id
        username
        displayName
      }
    }
  }
`

export const GET_PLAYBOOKS = /* GraphQL */ `
  ${PLAYBOOK_FIELDS}
  query GetPlaybooks {
    playbooks { ...PlaybookFields }
  }
`
