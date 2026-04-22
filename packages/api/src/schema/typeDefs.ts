export const typeDefs = /* GraphQL */ `
  type Query {
    board(id: ID!): Board
    boards: [Board!]!
    task(id: ID!): Task
    agentRuns(taskId: ID!): [AgentRun!]!
    taskProgress(taskId: ID!): [TaskProgress!]!
    workspaceSnapshot(id: ID!): WorkspaceSnapshot
    workspaceSnapshotPatch(id: ID!): String
    taskTimeline(taskId: ID!): [TaskEvent!]!
    comments(taskId: ID!): [Comment!]!
    tags(boardId: ID!): [Tag!]!
    me: User!
    users: [User!]!
    invitations: [Invitation!]!
    authConfig: AuthConfig!
  }

  type Mutation {
    createBoard(name: String!): Board!
    createTask(input: CreateTaskInput!): Task!
    updateTask(id: ID!, input: UpdateTaskInput!): Task!

    moveTask(id: ID!, columnId: ID!, position: Float!): Task!
    archiveTask(id: ID!): Task!
    unarchiveTask(id: ID!): Task!
    addComment(taskId: ID!, body: String!, parentId: ID): Comment!
    updateComment(id: ID!, body: String!): Comment!
    deleteComment(id: ID!): Boolean!
    createTag(input: CreateTagInput!): Tag!
    deleteTag(id: ID!, boardId: ID!): Boolean!
    setTaskTags(taskId: ID!, tagIds: [ID!]!): Task!
    cancelAgent(taskId: ID!): Task!
    runAgent(taskId: ID!, action: BoardAction!, instruction: String): Task!

    sendHint(taskId: ID!, body: String!): TaskMessage!
    sendRedirect(taskId: ID!, body: String!): TaskMessage!
    answerQuestion(taskId: ID!, body: String!): TaskMessage!

    addTaskDependency(taskId: ID!, blockerId: ID!): Task!
    removeTaskDependency(taskId: ID!, blockerId: ID!): Task!

    setTimeBox(taskId: ID!, timeBoxMs: Int): Task!
    extendTimeBox(taskId: ID!, additionalMs: Int!): Task!
    killTask(taskId: ID!): Task!

    setTaskVerifyCommands(taskId: ID!, commands: [VerifyCommandInput!]): Task!

    generateInvitation(githubUsername: String!): Invitation!
    revokeUser(userId: ID!): User!
  }

  type Subscription {
    taskUpdated(boardId: ID!): Task!
    agentLogStream(taskId: ID!): AgentLogChunk!
    scratchpadUpdated(taskId: ID!): ScratchpadChunk!
    commentAdded(taskId: ID!): Comment!
    commentUpdated(taskId: ID!): Comment!
    taskEventAdded(taskId: ID!): TaskEvent!
    messageAdded(taskId: ID!): TaskMessage!
    verificationRunAdded(taskId: ID!): VerificationRun!
    taskProgressAdded(taskId: ID!): TaskProgress!
    workspaceSnapshotAdded(taskId: ID!): WorkspaceSnapshot!
  }

  type User {
    id: ID!
    username: String!
    displayName: String!
    role: String!
    githubId: String
    githubUsername: String
    revokedAt: String
    createdAt: String!
  }

  type Invitation {
    id: ID!
    token: String!
    githubUsername: String!
    createdBy: User!
    createdAt: String!
    expiresAt: String!
    usedAt: String
  }

  type AuthConfig {
    githubOAuthClientId: String
    isLocal: Boolean!
  }

  type Board {
    id: ID!
    name: String!
    columns: [Column!]!
    tags: [Tag!]!
    createdBy: User!
    createdAt: String!
  }

  type Column {
    id: ID!
    name: String!
    position: Float!
    tasks: [Task!]!
  }

  type Task {
    id: ID!
    title: String!
    body: String!
    column: Column!
    position: Float!
    action: BoardAction
    agentInstruction: String
    targetRepo: String
    targetBranch: String
    agentStatus: AgentStatus!
    retryCount: Int!
    prUrl: String
    scratchpad: String!
    archived: Boolean!
    archivedAt: String
    createdBy: User!
    updatedBy: User!
    tags: [Tag!]!
    comments: [Comment!]!
    messages: [TaskMessage!]!
    currentQuestion: TaskMessage
    verificationRuns: [VerificationRun!]!
    workspaceSnapshots: [WorkspaceSnapshot!]!
    verifyAttemptCount: Int!
    verifyCommandsOverride: [VerifyCommand!]
    parentTask: Task
    subtasks: [Task!]!
    blockers: [Task!]!
    dependents: [Task!]!
    blockReason: BlockReason
    timeBoxMs: Int
    timeBoxStartedAt: String
    timeBoxRemainingMs: Int
    createdAt: String!
    updatedAt: String!
  }

  type Tag {
    id: ID!
    name: String!
    color: String!
  }

  enum AgentStatus {
    IDLE
    QUEUED
    RUNNING
    BLOCKED
    SUCCESS
    FAILED
  }

  enum BoardAction {
    PLAN
    IMPLEMENT
    REVISE
  }

  enum MessageKind {
    HINT
    REDIRECT
    QUESTION
    ANSWER
  }

  enum MessageAuthorType {
    HUMAN
    AGENT
  }

  enum BlockReason {
    QUESTION
    TIMEOUT
    DEPENDENCY_FAILED
  }

  type Comment {
    id: ID!
    body: String!
    parentId: ID
    replies: [Comment!]!
    createdBy: User!
    createdAt: String!
    updatedAt: String!
  }

  type TaskMessage {
    id: ID!
    taskId: ID!
    authorType: MessageAuthorType!
    kind: MessageKind!
    body: String!
    deliveredAt: String
    createdBy: User
    createdAt: String!
  }

  type TaskEvent {
    id: ID!
    type: String!
    actor: User
    isSystem: Boolean!
    data: String
    createdAt: String!
  }

  type AgentRun {
    id: ID!
    action: String!
    status: String!
    output: String
    error: String
    startedAt: String!
    finishedAt: String
  }

  type AgentLogChunk {
    taskId: ID!
    chunk: String!
    timestamp: String!
  }

  type ScratchpadChunk {
    taskId: ID!
    content: String!
    updatedAt: String!
  }

  type VerificationRun {
    id: ID!
    taskId: ID!
    agentRunId: ID
    command: String!
    label: String!
    exitCode: Int!
    output: String!
    startedAt: String!
    finishedAt: String!
  }

  enum ProgressStatus {
    IN_PROGRESS
    DONE
    FAILED
  }

  type TaskProgress {
    taskId: ID!
    agentRunId: ID
    ts: String!
    step: Int!
    total: Int!
    label: String!
    detail: String
    status: ProgressStatus!
  }

  type SnapshotFileEntry {
    path: String!
    status: String!
    additions: Int!
    deletions: Int!
  }

  type WorkspaceSnapshot {
    id: ID!
    taskId: ID!
    agentRunId: ID
    statSummary: String!
    fileStatus: [SnapshotFileEntry!]!
    hasPatch: Boolean!
    capturedAt: String!
  }

  type VerifyCommand {
    label: String!
    run: String!
    timeoutMs: Int
  }

  input VerifyCommandInput {
    label: String!
    run: String!
    timeoutMs: Int
  }

  input CreateTaskInput {
    boardId: ID!
    columnId: ID
    title: String!
    body: String
    agentInstruction: String
    targetRepo: String
    targetBranch: String
    tagIds: [ID!]
    sessionId: String
  }

  input UpdateTaskInput {
    title: String
    body: String
    agentInstruction: String
    targetRepo: String
    targetBranch: String
    tagIds: [ID!]
  }

  input CreateTagInput {
    boardId: ID!
    name: String!
    color: String
  }
`
