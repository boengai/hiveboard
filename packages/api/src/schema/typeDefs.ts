export const typeDefs = /* GraphQL */ `
  type Query {
    board(id: ID!): Board
    boards: [Board!]!
    task(id: ID!): Task
    agentRuns(taskId: ID!): [AgentRun!]!
    taskTimeline(taskId: ID!): [TaskEvent!]!
    comments(taskId: ID!): [Comment!]!
    tags(boardId: ID!): [Tag!]!
    me: User!
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
  }

  type Subscription {
    taskUpdated(boardId: ID!): Task!
    agentLogStream(taskId: ID!): AgentLogChunk!
    commentAdded(taskId: ID!): Comment!
    commentUpdated(taskId: ID!): Comment!
    taskEventAdded(taskId: ID!): TaskEvent!
  }

  type User {
    id: ID!
    username: String!
    displayName: String!
    role: String!
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
    archived: Boolean!
    archivedAt: String
    createdBy: User!
    updatedBy: User!
    tags: [Tag!]!
    comments: [Comment!]!
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
    SUCCESS
    FAILED
  }

  enum BoardAction {
    PLAN
    IMPLEMENT
    REVISE
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

  input CreateTaskInput {
    boardId: ID!
    columnId: ID
    title: String!
    body: String
    action: BoardAction
    agentInstruction: String
    targetRepo: String
    targetBranch: String
    tagIds: [ID!]
    sessionId: String
  }

  input UpdateTaskInput {
    title: String
    body: String
    action: BoardAction
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
