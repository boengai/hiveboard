# HiveBoard API Reference

> Auto-generated reference for the HiveBoard GraphQL API.
> Source of truth: [`packages/api/src/schema/typeDefs.ts`](../packages/api/src/schema/typeDefs.ts)
>
> See also: [Maintainer Guide](./maintainer-guide.md)

---

## 1. Endpoint Info

| Item | Details |
|---|---|
| **GraphQL endpoint** | `http://localhost:{API_PORT}/graphql` (default port `8080`) |
| **Health check** | `GET /health` -- returns `{ "ok": true, "uptime": <seconds> }` |
| **Subscriptions** | Served over **SSE** (Server-Sent Events) on the same `/graphql` endpoint via [GraphQL Yoga](https://the-guild.dev/graphql/yoga-server) |
| **CORS** | `origin: *`, credentials enabled |
| **Static assets (production)** | SPA served from `packages/web/dist` with fallback to `index.html` |

The server is powered by **Bun** (`Bun.serve`). The port is configurable via the `API_PORT` environment variable.

---

## 2. Queries

### `boards: [Board!]!`

Returns all boards ordered by creation date (ascending).

### `board(id: ID!): Board`

Returns a single board by ID, or `null` if not found.

### `task(id: ID!): Task`

Returns a single task by ID, or `null` if not found.

### `agentRuns(taskId: ID!): [AgentRun!]!`

Returns all agent runs for a given task, ordered by `startedAt` descending (most recent first).

### `taskTimeline(taskId: ID!): [TaskEvent!]!`

Returns all timeline events for a task, ordered by `createdAt` ascending.

### `comments(taskId: ID!): [Comment!]!`

Returns top-level comments (where `parentId` is `null`) for a task, ordered by `createdAt` ascending.

### `me: User!`

Returns the current authenticated user (currently hardcoded to the `queen-bee` user).

---

## 3. Mutations

### `createBoard(name: String!): Board!`

Creates a new board.

- **Side effects:** None (no PubSub events).

---

### `createTask(input: CreateTaskInput!): Task!`

Creates a new task in the specified board and column.

- If `columnId` is omitted, defaults to the **first column** (lowest position) of the board.
- `targetBranch` defaults to `"main"` if not provided.
- Position is auto-calculated as `max(position) + 1024` in the target column.
- **Task events recorded:** `created`
- **PubSub:** `TASK_UPDATED` (scoped to boardId), `TASK_EVENT` (scoped to taskId)

---

### `updateTask(id: ID!, input: UpdateTaskInput!): Task!`

Updates mutable fields on an existing task. Only fields present in the input are changed.

- **Task events recorded (conditional):**
  - `title_changed` -- with `{ from, to }` data
  - `body_changed` -- no data payload
  - `action_set` / `action_cleared` -- with `{ action }` data when set
- **PubSub:** `TASK_UPDATED` (scoped to boardId), `TASK_EVENT` for each change event (scoped to taskId)

---

### `moveTask(id: ID!, columnId: ID!, position: Float!): Task!`

Moves a task to a new column and/or position.

- **Re-indexing:** If any gap between adjacent tasks in the target column drops below `1.0`, all positions in that column are re-indexed at intervals of `1024`.
- **Task events recorded:** `moved` with `{ from_column, to_column }` data (column names, not IDs).
- **PubSub:** `TASK_UPDATED` (scoped to boardId), `TASK_EVENT` (scoped to taskId)

---

### `archiveTask(id: ID!): Task!`

Soft-archives a task (sets `archived = true`, records `archivedAt` timestamp). Archived tasks are excluded from column task lists.

- **Task events recorded:** `archived`
- **PubSub:** `TASK_UPDATED` (scoped to boardId), `TASK_EVENT` (scoped to taskId)

---

### `unarchiveTask(id: ID!): Task!`

Restores a previously archived task (sets `archived = false`, clears `archivedAt`).

- **Task events recorded:** `unarchived`
- **PubSub:** `TASK_UPDATED` (scoped to boardId), `TASK_EVENT` (scoped to taskId)

---

### `addComment(taskId: ID!, body: String!, parentId: ID): Comment!`

Adds a comment to a task. If `parentId` is provided, creates a reply (max 1 level of nesting).

- **Validation:** If `parentId` itself has a parent, the mutation throws ("Cannot nest replies more than 1 level deep").
- **Task events recorded:** `comment_added` with `{ comment_id }` data
- **PubSub:** `COMMENT_ADDED` (scoped to taskId), `TASK_EVENT` (scoped to taskId)

---

### `updateComment(id: ID!, body: String!): Comment!`

Updates a comment's body text.

- **PubSub:** `COMMENT_ADDED` (scoped to taskId) -- reuses the same channel for updates.

---

### `deleteComment(id: ID!): Boolean!`

Deletes a comment permanently.

- **Task events recorded:** `comment_deleted` with `{ comment_id }` data
- **PubSub:** `TASK_EVENT` (scoped to taskId)

---

### `dispatchAgent(taskId: ID!, action: String!): Task!`

Dispatches an AI agent to work on a task.

- **Valid actions:** `idle`, `plan`, `research`, `implement`, `implement-e2e`, `revise`
- **Preconditions:**
  - Task `agentStatus` must be `IDLE` or `FAILED`.
  - Actions `implement`, `implement-e2e`, and `revise` require `targetRepo` to be set on the task.
- Sets `agentStatus` to `QUEUED` and `action` to the requested value.
- **Task events recorded:** `action_set` with `{ action }`, `status_changed` with `{ from: "idle", to: "queued" }`
- **PubSub:** `TASK_UPDATED` (scoped to boardId), `TASK_EVENT` for each event (scoped to taskId)

---

### `cancelAgent(taskId: ID!): Task!`

Cancels a running or queued agent. Calls `orchestrator.cancelTask()` to abort the process, then resets `agentStatus` to `IDLE`.

- **Task events recorded:** `status_changed` with `{ from: <current>, to: "idle" }`
- **PubSub:** `TASK_UPDATED` (scoped to boardId), `TASK_EVENT` (scoped to taskId)

---

## 4. Subscriptions

All subscriptions use **SSE** (Server-Sent Events) via GraphQL Yoga.

### `taskUpdated(boardId: ID!): Task!`

Fires whenever any task in the given board is created, updated, moved, archived, or unarchived. Returns the full updated `Task` object.

- **PubSub channel:** `TASK_UPDATED` scoped by `boardId`

### `agentLogStream(taskId: ID!): AgentLogChunk!`

Streams real-time log output from a running agent for the given task.

- **PubSub channel:** `AGENT_LOG` scoped by `taskId`

### `commentAdded(taskId: ID!): Comment!`

Fires when a comment is added or updated on the given task.

- **PubSub channel:** `COMMENT_ADDED` scoped by `taskId`

### `taskEventAdded(taskId: ID!): TaskEvent!`

Fires whenever a new timeline event is recorded for the given task (moves, status changes, comments, etc.).

- **PubSub channel:** `TASK_EVENT` scoped by `taskId`

---

## 5. Types

### `User`

```graphql
type User {
  id: ID!
  username: String!
  displayName: String!
  role: String!
}
```

### `Board`

```graphql
type Board {
  id: ID!
  name: String!
  columns: [Column!]!
  createdBy: User!
  createdAt: String!
}
```

- `columns` are resolved lazily and ordered by `position` ascending.

### `Column`

```graphql
type Column {
  id: ID!
  name: String!
  position: Float!
  tasks: [Task!]!
}
```

- `tasks` only includes non-archived tasks (`archived = 0`), ordered by `position` ascending.

### `Task`

```graphql
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
  comments: [Comment!]!
  createdAt: String!
  updatedAt: String!
}
```

- `agentStatus` is stored lowercase in SQLite and uppercased at the resolver layer.
- `comments` returns top-level comments only (no replies inlined at root level).

### `Comment`

```graphql
type Comment {
  id: ID!
  body: String!
  parentId: ID
  replies: [Comment!]!
  createdBy: User!
  createdAt: String!
  updatedAt: String!
}
```

- Max nesting depth is 1 (top-level comments can have replies, but replies cannot have sub-replies).

### `TaskEvent`

```graphql
type TaskEvent {
  id: ID!
  type: String!
  actor: User
  isSystem: Boolean!
  data: String
  createdAt: String!
}
```

- `actor` resolves to `null` when the actor is `"SYSTEM"`.
- `isSystem` is `true` when the actor is `"SYSTEM"`.
- `data` is a JSON-encoded string (or `null`). Common shapes:
  - `created`: no data
  - `moved`: `{ "from_column": "...", "to_column": "..." }`
  - `title_changed`: `{ "from": "...", "to": "..." }`
  - `action_set`: `{ "action": "..." }`
  - `status_changed`: `{ "from": "...", "to": "..." }`
  - `comment_added` / `comment_deleted`: `{ "comment_id": "..." }`
  - `archived` / `unarchived`: no data
  - `body_changed`: no data

### `AgentRun`

```graphql
type AgentRun {
  id: ID!
  action: String!
  status: String!
  output: String
  error: String
  startedAt: String!
  finishedAt: String
}
```

### `AgentLogChunk`

```graphql
type AgentLogChunk {
  taskId: ID!
  chunk: String!
  timestamp: String!
}
```

---

## 6. Enums

### `AgentStatus`

```graphql
enum AgentStatus {
  IDLE
  QUEUED
  RUNNING
  SUCCESS
  FAILED
}
```

State machine flow: `IDLE` -> `QUEUED` -> `RUNNING` -> `SUCCESS` | `FAILED` -> (back to `IDLE` via cancel or re-dispatch).

---

## 7. Input Types

### `CreateTaskInput`

```graphql
input CreateTaskInput {
  boardId: ID!
  columnId: ID
  title: String!
  body: String
  action: String
  targetRepo: String
  targetBranch: String
}
```

- `columnId` -- optional; defaults to the first column in the board.
- `targetBranch` -- optional; defaults to `"main"` in the resolver.

### `UpdateTaskInput`

```graphql
input UpdateTaskInput {
  title: String
  body: String
  action: String
  targetRepo: String
  targetBranch: String
}
```

All fields are optional. Only provided fields are updated.

---

## 8. PubSub Channels (Internal Reference)

> Defined in [`packages/api/src/pubsub.ts`](../packages/api/src/pubsub.ts). These are internal channel names used by `graphql-yoga`'s `createPubSub`.

| Channel | Scope Key | Payload | Published By |
|---|---|---|---|
| `TASK_UPDATED` | `boardId` | Full `Task` object | `createTask`, `updateTask`, `moveTask`, `archiveTask`, `unarchiveTask`, `dispatchAgent`, `cancelAgent` |
| `AGENT_LOG` | `taskId` | `AgentLogChunk` (`{ taskId, chunk, timestamp }`) | Orchestrator (via `publishAgentLog`) |
| `COMMENT_ADDED` | `taskId` | Full `Comment` object | `addComment`, `updateComment` |
| `TASK_EVENT` | `taskId` | `TaskEvent` object | `createTask`, `updateTask`, `moveTask`, `archiveTask`, `unarchiveTask`, `addComment`, `deleteComment`, `dispatchAgent`, `cancelAgent` |

### Helper functions (exported from `pubsub.ts`)

| Function | Signature |
|---|---|
| `publishTaskUpdated` | `(boardId: string, task: unknown) => void` |
| `publishAgentLog` | `(taskId: string, chunk: { taskId: string; chunk: string; timestamp: string }) => void` |
| `publishCommentAdded` | `(taskId: string, comment: unknown) => void` |
| `publishTaskEvent` | `(taskId: string, event: unknown) => void` |
