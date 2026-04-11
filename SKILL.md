# HiveBoard GraphQL API Skill

HiveBoard is a Kanban-style project management tool with built-in AI agent orchestration per task.

**Endpoint:** `{{HIVEBOARD_URL}}/graphql`

All requests use standard GraphQL over HTTP POST with a JSON body: `{ "query": "...", "variables": {...} }`.

---

## List Boards and Their Columns/Tasks

```graphql
query {
  boards {
    id
    name
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

## Get a Specific Task

```graphql
query GetTask($id: ID!) {
  task(id: $id) {
    id
    title
    body
    agentStatus
    prUrl
    action
    targetRepo
    targetBranch
    archived
    column { id name }
    tags { id name color }
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
    action
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
    "action": "Implement feature X"
  }
}
```

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

## Add a Comment to a Task

```graphql
mutation AddComment($taskId: ID!, $body: String!) {
  addComment(taskId: $taskId, body: $body) {
    id
    body
    createdAt
    createdBy { displayName }
  }
}
```

To reply to an existing comment, include `parentId: "<comment-id>"` in the mutation arguments.

## Archive / Unarchive a Task

```graphql
mutation ArchiveTask($id: ID!) {
  archiveTask(id: $id) { id archived archivedAt }
}

mutation UnarchiveTask($id: ID!) {
  unarchiveTask(id: $id) { id archived }
}
```

## Create and Assign Tags

```graphql
# Create a tag on a board
mutation CreateTag($input: CreateTagInput!) {
  createTag(input: $input) {
    id
    name
    color
  }
}
# Variables: { "input": { "boardId": "<board-id>", "name": "bug", "color": "#e53e3e" } }

# List existing tags on a board
query Tags($boardId: ID!) {
  tags(boardId: $boardId) { id name color }
}

# Assign tags to a task (replaces all existing tags)
mutation SetTaskTags($taskId: ID!, $tagIds: [ID!]!) {
  setTaskTags(taskId: $taskId, tagIds: $tagIds) {
    id
    tags { id name color }
  }
}
```

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

---

## Real-Time Subscriptions (SSE)

HiveBoard exposes GraphQL subscriptions via Server-Sent Events at the same `/graphql` endpoint. Key subscriptions:

| Subscription | Trigger |
|---|---|
| `taskUpdated(boardId: ID!)` | Any task change on a board |
| `agentLogStream(taskId: ID!)` | Live log chunks from a running agent |
| `commentAdded(taskId: ID!)` | New comment on a task |
| `taskEventAdded(taskId: ID!)` | Timeline event added to a task |

---

## Key Types

**AgentStatus enum**
- `IDLE` — no agent activity
- `QUEUED` — agent is waiting to run
- `RUNNING` — agent is actively executing
- `SUCCESS` — agent completed successfully
- `FAILED` — agent encountered an error

**Task** — core work item; lives in a Column; has optional agent fields (`action`, `agentStatus`, `prUrl`)

**Board** — top-level container with Columns and Tags

**Column** — ordered list of Tasks within a Board

**Tag** — board-scoped label with a name and hex color; assigned to tasks via `setTaskTags`

**Comment** — threaded note on a Task; supports `parentId` for replies

**AgentRun** — historical record of a single agent execution on a task; query via `agentRuns(taskId: ID!)`
