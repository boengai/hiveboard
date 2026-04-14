# HiveBoard GraphQL API Skill

HiveBoard is a Kanban-style project management tool with built-in AI agent orchestration per task.

**Endpoint:** `{{HIVEBOARD_URL}}/graphql`

All requests use standard GraphQL over HTTP POST with a JSON body: `{ "query": "...", "variables": {...} }`.

---

## Current User

```graphql
query {
  me { id username displayName role }
}
```

## List Boards and Their Columns/Tasks

```graphql
query {
  boards {
    id
    name
    createdBy { displayName }
    createdAt
    columns {
      id
      name
      position
      tasks {
        id
        title
        agentStatus
        archived
      }
    }
  }
}
```

## Get a Specific Board

```graphql
query GetBoard($id: ID!) {
  board(id: $id) {
    id
    name
    columns { id name position }
    tags { id name color }
    createdBy { displayName }
    createdAt
  }
}
```

## Create a Board

```graphql
mutation CreateBoard($name: String!) {
  createBoard(name: $name) {
    id
    name
  }
}
```

## Get a Specific Task

```graphql
query GetTask($id: ID!) {
  task(id: $id) {
    id
    title
    body
    position
    action
    agentInstruction
    agentStatus
    retryCount
    prUrl
    targetRepo
    targetBranch
    archived
    archivedAt
    column { id name }
    tags { id name color }
    comments { id body createdBy { displayName } createdAt }
    createdBy { displayName }
    updatedBy { displayName }
    createdAt
    updatedAt
  }
}
```

## Create a Task

```graphql
mutation CreateTask($input: CreateTaskInput!) {
  createTask(input: $input) {
    id
    title
    column { id name }
  }
}
```

Variables:
```json
{
  "input": {
    "boardId": "<board-id>",
    "columnId": "<column-id>",
    "title": "Task title",
    "body": "Optional description",
    "agentInstruction": "Optional custom instruction for the agent",
    "targetRepo": "owner/repo",
    "targetBranch": "main",
    "tagIds": []
  }
}
```

`columnId` is optional — omit to place the task in the board's default column.

## Update a Task

```graphql
mutation UpdateTask($id: ID!, $input: UpdateTaskInput!) {
  updateTask(id: $id, input: $input) {
    id
    title
    body
    agentInstruction
    targetRepo
    targetBranch
  }
}
```

Variables:
```json
{
  "id": "<task-id>",
  "input": {
    "title": "Updated title",
    "body": "Updated description",
    "agentInstruction": "Custom agent instruction"
  }
}
```

`action` is not part of `UpdateTaskInput` — use `runAgent` to set the action and trigger the agent.

## Move a Task Between Columns

```graphql
mutation MoveTask($id: ID!, $columnId: ID!, $position: Float!) {
  moveTask(id: $id, columnId: $columnId, position: $position) {
    id
    column { id name }
    position
  }
}
```

`position` is a float used for ordering within the column. Use `1.0` to place at top, or a value between existing tasks to insert between them.

## Comments

```graphql
# List comments for a task
query Comments($taskId: ID!) {
  comments(taskId: $taskId) {
    id
    body
    parentId
    replies { id body createdBy { displayName } createdAt }
    createdBy { displayName }
    createdAt
    updatedAt
  }
}

# Add a comment (use parentId for threaded replies, 1 level deep)
mutation AddComment($taskId: ID!, $body: String!, $parentId: ID) {
  addComment(taskId: $taskId, body: $body, parentId: $parentId) {
    id
    body
    createdAt
    createdBy { displayName }
  }
}

# Update a comment
mutation UpdateComment($id: ID!, $body: String!) {
  updateComment(id: $id, body: $body) {
    id
    body
    updatedAt
  }
}

# Delete a comment
mutation DeleteComment($id: ID!) {
  deleteComment(id: $id)
}
```

## Archive / Unarchive a Task

```graphql
mutation ArchiveTask($id: ID!) {
  archiveTask(id: $id) { id archived archivedAt }
}

mutation UnarchiveTask($id: ID!) {
  unarchiveTask(id: $id) { id archived }
}
```

## Tags

```graphql
# List existing tags on a board
query Tags($boardId: ID!) {
  tags(boardId: $boardId) { id name color }
}

# Create a tag on a board (color defaults to #aaaaaa if omitted)
mutation CreateTag($input: CreateTagInput!) {
  createTag(input: $input) {
    id
    name
    color
  }
}
# Variables: { "input": { "boardId": "<board-id>", "name": "bug", "color": "#e53e3e" } }

# Delete a tag from a board
mutation DeleteTag($id: ID!, $boardId: ID!) {
  deleteTag(id: $id, boardId: $boardId)
}

# Assign tags to a task (replaces all existing tags)
mutation SetTaskTags($taskId: ID!, $tagIds: [ID!]!) {
  setTaskTags(taskId: $taskId, tagIds: $tagIds) {
    id
    tags { id name color }
  }
}
```

## Run an Agent

```graphql
mutation RunAgent($taskId: ID!, $action: BoardAction!, $instruction: String) {
  runAgent(taskId: $taskId, action: $action, instruction: $instruction) {
    id
    action
    agentInstruction
    agentStatus
  }
}
```

Sets the task's `action`, optionally updates `agentInstruction`, and queues the agent with a 15-second grace period. Fails if the agent is already `RUNNING` or `QUEUED`.

## Cancel a Running Agent

```graphql
mutation CancelAgent($taskId: ID!) {
  cancelAgent(taskId: $taskId) {
    id
    agentStatus
  }
}
```

Only meaningful when `agentStatus` is `RUNNING` or `QUEUED`.

## Agent Runs (History)

```graphql
query AgentRuns($taskId: ID!) {
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
```

## Task Timeline

```graphql
query TaskTimeline($taskId: ID!) {
  taskTimeline(taskId: $taskId) {
    id
    type
    actor { displayName }
    isSystem
    data
    createdAt
  }
}
```

---

## Real-Time Subscriptions (SSE)

HiveBoard exposes GraphQL subscriptions via Server-Sent Events at the same `/graphql` endpoint.

| Subscription | Trigger |
|---|---|
| `taskUpdated(boardId: ID!)` | Any task change on a board |
| `agentLogStream(taskId: ID!)` | Live log chunks from a running agent |
| `commentAdded(taskId: ID!)` | New comment on a task |
| `commentUpdated(taskId: ID!)` | Comment edited on a task |
| `taskEventAdded(taskId: ID!)` | Timeline event added to a task |

---

## Key Types

**AgentStatus enum**
- `IDLE` — no agent activity
- `QUEUED` — agent is waiting to run
- `RUNNING` — agent is actively executing
- `SUCCESS` — agent completed successfully
- `FAILED` — agent encountered an error

**BoardAction enum**
- `PLAN` — agent plans the work
- `IMPLEMENT` — agent implements the task
- `REVISE` — agent revises based on feedback

**User** — authenticated user with `id`, `username`, `displayName`, `role`

**Board** — top-level container with Columns, Tags, and `createdBy` user

**Column** — ordered list of Tasks within a Board

**Task** — core work item; lives in a Column; has agent fields (`action`, `agentInstruction`, `agentStatus`, `retryCount`, `prUrl`); tracks `createdBy`/`updatedBy`

**Tag** — board-scoped label with a name and hex color; assigned to tasks via `setTaskTags`

**Comment** — threaded note on a Task; supports `parentId` for replies (1 level deep)

**TaskEvent** — audit trail entry for a task; `type` describes the event, `data` holds JSON details, `isSystem` distinguishes system vs user events

**AgentRun** — historical record of a single agent execution on a task

**AgentLogChunk** — streaming log output from a running agent with `taskId`, `chunk`, `timestamp`
