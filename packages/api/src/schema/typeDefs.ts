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
    deleteTag(id: ID!): Boolean!
    setTaskTags(taskId: ID!, tagIds: [ID!]!): Task!
    dispatchAgent(taskId: ID!, action: String!): Task!
    cancelAgent(taskId: ID!): Task!
  }

  type Subscription {
    taskUpdated(boardId: ID!): Task!
    agentLogStream(taskId: ID!): AgentLogChunk!
    commentAdded(taskId: ID!): Comment!
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
    action: String
    targetRepo: String
    targetBranch: String
    agentStatus: AgentStatus!
    agentOutput: String
    agentError: String
    retryCount: Int!
    prUrl: String
    prNumber: Int
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
    action: String
    targetRepo: String
    targetBranch: String
    tagIds: [ID!]
  }

  input UpdateTaskInput {
    title: String
    body: String
    action: String
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
