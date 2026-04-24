import { PLAYBOOK_FIELDS } from './playbook-fragments'

export const CREATE_TASK = /* GraphQL */ `
  mutation CreateTask($input: CreateTaskInput!) {
    createTask(input: $input) {
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

export const UPDATE_TASK = /* GraphQL */ `
  mutation UpdateTask($id: ID!, $input: UpdateTaskInput!) {
    updateTask(id: $id, input: $input) {
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

export const CANCEL_AGENT = /* GraphQL */ `
  mutation CancelAgent($taskId: ID!) {
    cancelAgent(taskId: $taskId) {
      id
      agentStatus
    }
  }
`

export const RUN_AGENT = /* GraphQL */ `
  mutation RunAgent($taskId: ID!, $action: String!, $instruction: String) {
    runAgent(taskId: $taskId, action: $action, instruction: $instruction) {
      id
      action
      agentInstruction
      agentStatus
      retryCount
    }
  }
`

export const CREATE_TAG = /* GraphQL */ `
  mutation CreateTag($input: CreateTagInput!) {
    createTag(input: $input) {
      id
      name
      color
    }
  }
`

export const DELETE_TAG = /* GraphQL */ `
  mutation DeleteTag($id: ID!, $boardId: ID!) {
    deleteTag(id: $id, boardId: $boardId)
  }
`

export const SET_TASK_TAGS = /* GraphQL */ `
  mutation SetTaskTags($taskId: ID!, $tagIds: [ID!]!) {
    setTaskTags(taskId: $taskId, tagIds: $tagIds) {
      id
      tags {
        id
        name
        color
      }
    }
  }
`

export const GENERATE_INVITATION = /* GraphQL */ `
  mutation GenerateInvitation($githubUsername: String!) {
    generateInvitation(githubUsername: $githubUsername) {
      id
      token
      githubUsername
      expiresAt
    }
  }
`

export const REVOKE_USER = /* GraphQL */ `
  mutation RevokeUser($userId: ID!) {
    revokeUser(userId: $userId) {
      id
      username
      revokedAt
    }
  }
`

const TASK_MESSAGE_FIELDS = /* GraphQL */ `
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
`

export const SEND_HINT = /* GraphQL */ `
  mutation SendHint($taskId: ID!, $body: String!) {
    sendHint(taskId: $taskId, body: $body) {
      ${TASK_MESSAGE_FIELDS}
    }
  }
`

export const SEND_REDIRECT = /* GraphQL */ `
  mutation SendRedirect($taskId: ID!, $body: String!) {
    sendRedirect(taskId: $taskId, body: $body) {
      ${TASK_MESSAGE_FIELDS}
    }
  }
`

export const SET_TASK_VERIFY_COMMANDS_MUTATION = /* GraphQL */ `
  mutation SetTaskVerifyCommands($taskId: ID!, $commands: [VerifyCommandInput!]) {
    setTaskVerifyCommands(taskId: $taskId, commands: $commands) {
      id
      verifyCommandsOverride {
        label
        run
        timeoutMs
      }
    }
  }
`

export const ANSWER_QUESTION = /* GraphQL */ `
  mutation AnswerQuestion($taskId: ID!, $body: String!) {
    answerQuestion(taskId: $taskId, body: $body) {
      ${TASK_MESSAGE_FIELDS}
    }
  }
`

export const ADD_TASK_DEPENDENCY = /* GraphQL */ `
  mutation AddTaskDependency($taskId: ID!, $blockerId: ID!) {
    addTaskDependency(taskId: $taskId, blockerId: $blockerId) {
      id
      blockers {
        id
        title
        agentStatus
        blockReason
      }
    }
  }
`

export const REMOVE_TASK_DEPENDENCY = /* GraphQL */ `
  mutation RemoveTaskDependency($taskId: ID!, $blockerId: ID!) {
    removeTaskDependency(taskId: $taskId, blockerId: $blockerId) {
      id
      blockers {
        id
        title
        agentStatus
        blockReason
      }
    }
  }
`

export const SET_TIME_BOX = /* GraphQL */ `
  mutation SetTimeBox($taskId: ID!, $timeBoxMs: Int) {
    setTimeBox(taskId: $taskId, timeBoxMs: $timeBoxMs) {
      id
      timeBoxMs
    }
  }
`

export const EXTEND_TIME_BOX = /* GraphQL */ `
  mutation ExtendTimeBox($taskId: ID!, $additionalMs: Int!) {
    extendTimeBox(taskId: $taskId, additionalMs: $additionalMs) {
      id
      agentStatus
      timeBoxMs
      blockReason
    }
  }
`

export const KILL_TASK = /* GraphQL */ `
  mutation KillTask($taskId: ID!) {
    killTask(taskId: $taskId) {
      id
      agentStatus
    }
  }
`

export const CONTINUE_FAILED_TASK = /* GraphQL */ `
  mutation ContinueFailedTask($taskId: ID!, $instruction: String) {
    continueFailedTask(taskId: $taskId, instruction: $instruction) {
      id
      agentStatus
      retryCount
      agentInstruction
      updatedAt
    }
  }
`

export const SET_BOARD_SECRET = /* GraphQL */ `
  mutation SetBoardSecret($boardId: ID!, $name: String!, $value: String!, $description: String) {
    setBoardSecret(boardId: $boardId, name: $name, value: $value, description: $description) {
      id name description createdAt updatedAt
    }
  }
`

export const DELETE_BOARD_SECRET = /* GraphQL */ `
  mutation DeleteBoardSecret($boardId: ID!, $name: String!) {
    deleteBoardSecret(boardId: $boardId, name: $name)
  }
`

export const SET_TASK_SECRET = /* GraphQL */ `
  mutation SetTaskSecret($taskId: ID!, $name: String!, $value: String!) {
    setTaskSecret(taskId: $taskId, name: $name, value: $value) {
      id name createdAt updatedAt
    }
  }
`

export const DELETE_TASK_SECRET = /* GraphQL */ `
  mutation DeleteTaskSecret($taskId: ID!, $name: String!) {
    deleteTaskSecret(taskId: $taskId, name: $name)
  }
`

export const SET_TASK_REQUIRED_SECRETS = /* GraphQL */ `
  mutation SetTaskRequiredSecrets($taskId: ID!, $names: [String!]!) {
    setTaskRequiredSecrets(taskId: $taskId, names: $names) {
      id requiredSecrets missingSecrets agentStatus
    }
  }
`

export const CREATE_PLAYBOOK = /* GraphQL */ `
  ${PLAYBOOK_FIELDS}
  mutation CreatePlaybook($input: CreatePlaybookInput!) {
    createPlaybook(input: $input) { ...PlaybookFields }
  }
`

export const UPDATE_PLAYBOOK = /* GraphQL */ `
  ${PLAYBOOK_FIELDS}
  mutation UpdatePlaybook($id: ID!, $input: UpdatePlaybookInput!) {
    updatePlaybook(id: $id, input: $input) { ...PlaybookFields }
  }
`

export const ARCHIVE_PLAYBOOK = /* GraphQL */ `
  ${PLAYBOOK_FIELDS}
  mutation ArchivePlaybook($id: ID!) {
    archivePlaybook(id: $id) { ...PlaybookFields }
  }
`

export const UNARCHIVE_PLAYBOOK = /* GraphQL */ `
  ${PLAYBOOK_FIELDS}
  mutation UnarchivePlaybook($id: ID!) {
    unarchivePlaybook(id: $id) { ...PlaybookFields }
  }
`
