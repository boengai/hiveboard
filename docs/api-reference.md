# HiveBoard API Reference

> Manually maintained from [`packages/api/src/schema/typeDefs.ts`](../packages/api/src/schema/typeDefs.ts).
> When the SDL changes, update this file in the same PR.
>
> See also: [Maintainer Guide](./maintainer-guide.md), [CHANGELOG](../CHANGELOG.md)

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

### Boards, tasks, and events

#### `boards: [Board!]!`

Returns all boards the current user can see, ordered by creation date (ascending).

#### `board(id: ID!): Board`

Returns a single board by ID, or `null` if not found / not authorized.

#### `task(id: ID!): Task`

Returns a single task by ID, or `null` if not found / not authorized.

#### `agentRuns(taskId: ID!): [AgentRun!]!`

Returns all agent runs for a given task, ordered by `startedAt` descending (most recent first).

#### `taskTimeline(taskId: ID!): [TaskEvent!]!`

Returns all timeline events for a task, ordered by `createdAt` ascending.

#### `comments(taskId: ID!): [Comment!]!`

Returns top-level comments (where `parentId` is `null`) for a task, ordered by `createdAt` ascending.

#### `tags(boardId: ID!): [Tag!]!`

Returns every tag defined on the given board, ordered by `name` ascending.

### Progress & workspace snapshots (Spec D)

#### `taskProgress(taskId: ID!): [TaskProgress!]!`

Returns all `TaskProgress` events emitted by the agent for this task, parsed from the on-disk `progress.ndjson` file. Ordered oldest -> newest. Returns an empty array if the agent hasn't emitted any pings.

#### `workspaceSnapshot(id: ID!): WorkspaceSnapshot`

Returns a single `git diff` snapshot by ID, or `null` if not found. Does **not** include the raw patch -- fetch that separately via `workspaceSnapshotPatch`.

#### `workspaceSnapshotPatch(id: ID!): String`

Returns the decompressed unified-diff patch for a snapshot, or `""` if the snapshot stored no patch (e.g., disk-budget guardrail tripped at 10 MB of accumulated patches for the task). Separated from `workspaceSnapshot` so paginated list views don't drag megabytes per page.

### Auth, users, and invitations

#### `me: User!`

Returns the current authenticated user.

#### `users: [User!]!`

Returns all non-revoked users. Requires super-admin.

#### `invitations: [Invitation!]!`

Returns all outstanding invitations. Requires super-admin.

#### `authConfig: AuthConfig!`

Returns public auth configuration (GitHub OAuth client ID and whether the server is running in local mode). Unauthenticated.

### Playbooks (Spec F)

#### `playbooks: [Playbook!]!`

Returns all playbooks (including archived ones), ordered by `name` ascending. Each playbook's `currentVersion` is pre-loaded; use `versions` on the returned type for full version history.

---

## 3. Mutations

### Boards, tasks, and columns

#### `createBoard(name: String!): Board!`

Creates a new board. The current user becomes the board owner. Seeds the default Kanban columns (`Backlog` / `In Progress` / `Review` / `Done`).

- **Side effects:** None published via PubSub.

---

#### `createTask(input: CreateTaskInput!): Task!`

Creates a new task in the specified board and column.

- If `columnId` is omitted, defaults to the **first column** (lowest position) of the board.
- `targetBranch` defaults to `"main"` if not provided.
- Position is auto-calculated as `max(position) + 1024` in the target column.
- **Task events recorded:** `created`
- **PubSub:** `TASK_UPDATED` (scoped to boardId), `TASK_EVENT` (scoped to taskId)

---

#### `updateTask(id: ID!, input: UpdateTaskInput!): Task!`

Updates mutable fields on an existing task. Only fields present in the input are changed.

- **Task events recorded (conditional):**
  - `title_changed` -- with `{ from, to }` data
  - `body_changed` -- no data payload
  - `agent_instruction_set` / `agent_instruction_cleared`
- **PubSub:** `TASK_UPDATED` (scoped to boardId), `TASK_EVENT` for each change event (scoped to taskId)

---

#### `moveTask(id: ID!, columnId: ID!, position: Float!): Task!`

Moves a task to a new column and/or position.

- **Re-indexing:** If any gap between adjacent tasks in the target column drops below `1.0`, all positions in that column are re-indexed at intervals of `1024`.
- **Task events recorded:** `moved` with `{ from_column, to_column }` data (column names, not IDs).
- **PubSub:** `TASK_UPDATED` (scoped to boardId), `TASK_EVENT` (scoped to taskId)

---

#### `archiveTask(id: ID!): Task!`

Soft-archives a task (sets `archived = true`, records `archivedAt` timestamp). Archived tasks are excluded from column task lists.

- **Task events recorded:** `archived`
- **PubSub:** `TASK_UPDATED` (scoped to boardId), `TASK_EVENT` (scoped to taskId)

---

#### `unarchiveTask(id: ID!): Task!`

Restores a previously archived task (sets `archived = false`, clears `archivedAt`).

- **Task events recorded:** `unarchived`
- **PubSub:** `TASK_UPDATED` (scoped to boardId), `TASK_EVENT` (scoped to taskId)

### Comments

#### `addComment(taskId: ID!, body: String!, parentId: ID): Comment!`

Adds a comment to a task. If `parentId` is provided, creates a reply (max 1 level of nesting).

- **Validation:** If `parentId` itself has a parent, the mutation throws ("Cannot nest replies more than 1 level deep").
- **Task events recorded:** `comment_added` with `{ comment_id }` data
- **PubSub:** `COMMENT_ADDED` (scoped to taskId), `TASK_EVENT` (scoped to taskId)

---

#### `updateComment(id: ID!, body: String!): Comment!`

Updates a comment's body text.

- **PubSub:** `COMMENT_UPDATED` (scoped to taskId).

---

#### `deleteComment(id: ID!): Boolean!`

Deletes a comment permanently.

- **Task events recorded:** `comment_deleted` with `{ comment_id }` data
- **PubSub:** `TASK_EVENT` (scoped to taskId)

### Tags

#### `createTag(input: CreateTagInput!): Tag!`

Creates a board-scoped tag. `color` defaults to `"#aaaaaa"` (light gray) and must match the hex-color regex.

#### `deleteTag(id: ID!, boardId: ID!): Boolean!`

Deletes a tag. `boardId` is validated against the tag's board for defense-in-depth against IDOR.

#### `setTaskTags(taskId: ID!, tagIds: [ID!]!): Task!`

Replaces the task's tag set with the supplied IDs. All IDs must belong to the task's board.

### Agent dispatch & control

#### `runAgent(taskId: ID!, action: String!, instruction: String): Task!`

Dispatches an AI agent to work on a task.

- **Valid `action` values:** `"plan"`, `"implement"`, `"revise"`, or `"playbook:<name>"` (Spec F).
  - **Breaking change vs. prior releases:** the `BoardAction` enum has been **removed**. `action` is now a plain `String`. External consumers that inspected the enum must switch to the string form.
- **Preconditions:**
  - Task `agentStatus` must not be `RUNNING` or `QUEUED`.
  - Actions `implement` and `revise` require `targetRepo` to be set on the task.
- If `action` starts with `playbook:`, the orchestrator looks up the playbook, resolves its `currentVersion`, and merges the version's defaults onto the task row (target branch, tags, verify commands, time box) before queueing. Archived or missing playbooks are rejected with `PLAYBOOK_ARCHIVED` / `PLAYBOOK_NOT_FOUND`.
- Sets `agentStatus` to `QUEUED` (with a `queue_after` grace delay) and records `agent_instruction`.
- **Task events recorded:** `action_set`, `status_changed`
- **PubSub:** `TASK_UPDATED` (scoped to boardId), `TASK_EVENT` (scoped to taskId)

---

#### `cancelAgent(taskId: ID!): Task!`

Cancels a running or queued agent. Calls `orchestrator.cancelTask()` to abort the subprocess, then resets `agentStatus` to `IDLE`.

- **Task events recorded:** `status_changed`
- **PubSub:** `TASK_UPDATED` (scoped to boardId), `TASK_EVENT` (scoped to taskId)

---

#### `continueFailedTask(taskId: ID!, instruction: String): Task!` (Spec G)

Manually continues a `FAILED` task. Rejects with `TASK_NOT_FAILED` if the task is not in the `FAILED` state. Increments `retry_count` to drive the replay-injection code path (see `AgentRunCheckpoint`). If `instruction` is provided, it is appended to the task's `agent_instruction`.

### Bidirectional channel (Spec B)

#### `sendHint(taskId: ID!, body: String!): TaskMessage!`

Non-urgent message from the human to the agent. Queued for prompt injection on the next spawn. If the task is currently `RUNNING`, the message is also appended to `$HIVEBOARD_INBOX`, which the agent polls via Bash. Never aborts a run.

- **PubSub:** `TASK_MESSAGE` (scoped to taskId).

#### `sendRedirect(taskId: ID!, body: String!): TaskMessage!`

Urgent course-correction. If the task is `RUNNING`, the orchestrator aborts the in-flight agent (via the existing `AbortController` path) and requeues with a 5-second grace window. The redirect is injected into the next prompt.

- **PubSub:** `TASK_MESSAGE` (scoped to taskId).

#### `answerQuestion(taskId: ID!, body: String!): TaskMessage!`

Responds to an agent question. Only valid when `agentStatus === BLOCKED` with `blockReason === QUESTION`; otherwise rejected with `TASK_NOT_BLOCKED`. Transitions the task to `QUEUED` with a 30-second grace window so additional `hint`/`redirect` messages can batch before the next spawn.

- **PubSub:** `TASK_MESSAGE` and `TASK_UPDATED`.

### Dependencies, time-boxing, and kill (Spec E)

#### `addTaskDependency(taskId: ID!, blockerId: ID!): Task!`

Declares that `taskId` is blocked by `blockerId`. Both tasks must be on the same board. Rejects with:
- `DEPENDENCY_SELF` if `taskId === blockerId`.
- `DEPENDENCY_CROSS_BOARD` if the tasks are on different boards.
- `DEPENDENCY_CYCLE` if adding the edge would close a cycle (detected via topological traversal before insert).

#### `removeTaskDependency(taskId: ID!, blockerId: ID!): Task!`

Removes a previously declared dependency edge. Idempotent.

#### `setTimeBox(taskId: ID!, timeBoxMs: Int): Task!`

Sets (or clears, with `null`) the per-task wall-clock budget. Takes effect on the **next** spawn.

#### `extendTimeBox(taskId: ID!, additionalMs: Int!): Task!`

Adds `additionalMs` to the task's `time_box_ms` and requeues it. Only valid when `agentStatus === BLOCKED` with `blockReason === TIMEOUT`; otherwise rejected with `TIME_BOX_NOT_EXPIRED`. `additionalMs` must be positive.

#### `killTask(taskId: ID!): Task!`

Aborts the current run (if any) and transitions the task to `FAILED` with `agent_error = 'killed by user'`.

### Self-verify (Spec C)

#### `setTaskVerifyCommands(taskId: ID!, commands: [VerifyCommandInput!]): Task!`

Sets (or clears, with `null`) a per-task verification suite override. When set, **replaces** (not merges with) the global `verify.commands` block from `WORKFLOW.md` for this task's verification runs. Passing `[]` disables verification for the task.

### Playbooks (Spec F)

#### `createPlaybook(input: CreatePlaybookInput!): Playbook!`

Creates a new playbook at `versionNumber = 1`. `name` must match `/^[a-z0-9]+(-[a-z0-9]+)*$/` and be unique; duplicates reject with `PLAYBOOK_NAME_TAKEN`.

#### `updatePlaybook(id: ID!, input: UpdatePlaybookInput!): Playbook!`

Creates a **new immutable version** under the existing playbook and promotes it to `currentVersion`. Prior versions remain intact and are still referenced by any `agent_runs.playbook_version_id` rows that used them.

#### `archivePlaybook(id: ID!): Playbook!` / `unarchivePlaybook(id: ID!): Playbook!`

Archived playbooks cannot be dispatched (`runAgent` rejects with `PLAYBOOK_ARCHIVED`) but remain queryable for history.

### Invitations & revocation

#### `generateInvitation(githubUsername: String!): Invitation!`

Super-admin only. `githubUsername` is validated against the GitHub username regex (1--39 chars, alphanumeric + hyphens, no leading/trailing hyphen, no consecutive hyphens).

#### `revokeUser(userId: ID!): User!`

Super-admin only. Sets `revoked_at` and invalidates every outstanding session. Cannot revoke the `queen-bee` super-admin.

### Secrets (Spec H)

#### `setBoardSecret(boardId: ID!, name: String!, value: String!, description: String): BoardSecret!`

Upsert a board-scoped secret. `name` must match `/^[A-Z_][A-Z0-9_]*$/` (standard env var convention). `value` must be non-empty. Plaintext is AES-256-GCM-encrypted with a KEK derived from `HIVEBOARD_SECRETS_KEY` via HKDF-SHA256 and is never returned by any query. If setting unblocks one or more `MISSING_SECRETS` tasks on the board, they are requeued with a 5-second grace window.

#### `deleteBoardSecret(boardId: ID!, name: String!): Boolean!`

Removes a board-scoped secret. Tasks that still require the name will transition to `MISSING_SECRETS` on their next spawn attempt.

#### `setTaskSecret(taskId: ID!, name: String!, value: String!): TaskSecret!`

Upsert a task-scoped secret (overrides the board-scoped value for this task). Same name/value validation as `setBoardSecret`.

#### `deleteTaskSecret(taskId: ID!, name: String!): Boolean!`

Removes a task-scoped override. The board-scoped secret (if any) becomes active again.

#### `setTaskRequiredSecrets(taskId: ID!, names: [String!]!): Task!`

Declares which secret names the task's agent run must have before it can spawn. Resolution order at spawn time: `task_secrets` -> `board_secrets` -> missing.

---

## 4. Subscriptions

All subscriptions use **SSE** (Server-Sent Events) via GraphQL Yoga.

| Subscription | Scope | Payload | Pubsub channel |
|---|---|---|---|
| `taskUpdated(boardId: ID!)` | boardId | Full `Task` | `TASK_UPDATED` |
| `agentLogStream(taskId: ID!)` | taskId | `AgentLogChunk` | `AGENT_LOG` |
| `commentAdded(taskId: ID!)` | taskId | `Comment` | `COMMENT_ADDED` |
| `commentUpdated(taskId: ID!)` | taskId | `Comment` | `COMMENT_UPDATED` |
| `taskEventAdded(taskId: ID!)` | taskId | `TaskEvent` | `TASK_EVENT` |
| `scratchpadUpdated(taskId: ID!)` (Spec A) | taskId | `ScratchpadChunk` | `SCRATCHPAD_UPDATED` |
| `messageAdded(taskId: ID!)` (Spec B) | taskId | `TaskMessage` | `TASK_MESSAGE` |
| `verificationRunAdded(taskId: ID!)` (Spec C) | taskId | `VerificationRun` | `VERIFICATION_RUN` |
| `taskProgressAdded(taskId: ID!)` (Spec D) | taskId | `TaskProgress` | `TASK_PROGRESS` |
| `workspaceSnapshotAdded(taskId: ID!)` (Spec D) | taskId | `WorkspaceSnapshot` | `WORKSPACE_SNAPSHOT` |
| `checkpointAdded(taskId: ID!)` (Spec G) | taskId | `AgentRunCheckpoint` | `AGENT_CHECKPOINT` |
| `taskMissingSecretsChanged(taskId: ID!)` (Spec H) | taskId | `[String!]!` | `TASK_MISSING_SECRETS_CHANGED` |

**Notes:**

- `scratchpadUpdated` is backed by an fs watcher on `{agent.state_root}/{task-id}/scratchpad.md`, debounced at 250 ms; ref-counted across subscribers.
- `taskProgressAdded` is backed by an fs watcher on the per-run `progress.ndjson` file, debounced at 100 ms; each NDJSON line produces one event. Malformed lines are skipped.
- `workspaceSnapshotAdded` fires at most once per 15 s (the orchestrator's snapshot interval) and only when the stat-hash changes.
- `checkpointAdded` fires once per parsed turn of the `stream-json` output from the Claude CLI. Feature is auto-disabled at boot if the CLI does not advertise `--output-format stream-json`.
- `taskMissingSecretsChanged` fires when a task's computed `missingSecrets` set changes (e.g., an admin added the missing value at the board level).

---

## 5. Types

### `User`

```graphql
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
```

### `Invitation`

```graphql
type Invitation {
  id: ID!
  token: String!
  githubUsername: String!
  createdBy: User!
  createdAt: String!
  expiresAt: String!
  usedAt: String
}
```

### `AuthConfig`

```graphql
type AuthConfig {
  githubOAuthClientId: String
  isLocal: Boolean!
}
```

### `Board`

```graphql
type Board {
  id: ID!
  name: String!
  columns: [Column!]!
  tags: [Tag!]!
  createdBy: User!
  createdAt: String!
  secrets: [BoardSecret!]!
}
```

- `columns` are resolved lazily and ordered by `position` ascending.
- `secrets` returns board-scoped secrets (names/metadata only -- no plaintext or ciphertext).

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

  # Spec A — scratchpad
  scratchpad: String!

  # Spec B — bidirectional channel
  messages: [TaskMessage!]!
  currentQuestion: TaskMessage

  # Spec C — self-verify
  verificationRuns: [VerificationRun!]!
  verifyAttemptCount: Int!
  verifyCommandsOverride: [VerifyCommand!]

  # Spec D — progress
  workspaceSnapshots: [WorkspaceSnapshot!]!

  # Spec E — orchestration
  parentTask: Task
  subtasks: [Task!]!
  blockers: [Task!]!
  dependents: [Task!]!
  blockReason: BlockReason
  timeBoxMs: Int
  timeBoxStartedAt: String
  timeBoxRemainingMs: Int

  # Spec H — secrets
  requiredSecrets: [String!]!
  missingSecrets: [String!]!
  taskSecrets: [TaskSecret!]!
}
```

Notes:

- `action` replaces the removed `BoardAction` enum. Value space: `"plan"`, `"implement"`, `"revise"`, or `"playbook:<name>"`.
- `agentStatus` is stored lowercase in SQLite and uppercased at the resolver layer.
- `scratchpad` resolves the on-disk file at query time, returning `""` if absent. Tail-capped to 64 KB with a `<!-- truncated: earlier notes omitted -->` marker when the file exceeds that size.
- `messages` returns oldest -> newest. `currentQuestion` is a convenience that returns the most recent `kind=QUESTION` row, or `null`.
- `verifyCommandsOverride` is `null` when the task uses the global defaults from `WORKFLOW.md`. An explicit empty array (`[]`) means verification is disabled for this task.
- `comments` returns top-level comments only (no replies inlined at root level).
- `blockers` / `dependents` are resolved via the `task_dependencies` join table. Parent/child roll-up is computed, not stored: a parent is `SUCCESS` only when every child with `parent_task_id = parent.id` is also `SUCCESS`.
- `timeBoxRemainingMs` is computed at resolver time from `timeBoxStartedAt` and `timeBoxMs`. Returns `null` when no time-box is active.
- `missingSecrets` is computed: names in `requiredSecrets` that cannot be resolved against `task_secrets` then `board_secrets`.
- `taskSecrets` never contains plaintext or ciphertext -- only names and metadata.

### `Tag`

```graphql
type Tag {
  id: ID!
  name: String!
  color: String!
}
```

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
  - `body_changed` / `agent_instruction_cleared`: no data
  - `agent_blocked`: `{ "body": "<question text>" }` (Spec B)
  - `time_box_expired`: `{ "limitMs": N }` (Spec E)
  - `subtasks_spawned`: `{ "count": N }` (Spec E)
  - `missing_secrets`: `{ "names": [...] }` (Spec H)

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
  checkpoints: [AgentRunCheckpoint!]!
  turnCount: Int!
}
```

- `checkpoints` is ordered by `turn` ascending (Spec G).
- `turnCount` is computed as `max(turn)` across the run's checkpoints, or `0` if none.

### `AgentRunCheckpoint` (Spec G)

```graphql
type AgentRunCheckpoint {
  id: ID!
  agentRunId: ID!
  turn: Int!
  kind: String!
  summary: String!
  rawBytes: Int!
  occurredAt: String!
}
```

- `kind` is one of `"assistant"`, `"tool_use"`, `"tool_result"`, `"error"`.
- `summary` is capped at 2 KB per row. Stored format varies by kind (see the spec doc for the exact summarizer rules).
- `rawBytes` is the size of the original event before summarization -- useful for spotting turns that produced large output without needing to store the raw payload.

### `AgentLogChunk`

```graphql
type AgentLogChunk {
  taskId: ID!
  chunk: String!
  timestamp: String!
}
```

### `ScratchpadChunk` (Spec A)

```graphql
type ScratchpadChunk {
  taskId: ID!
  content: String!
  updatedAt: String!
}
```

### `TaskMessage` (Spec B)

```graphql
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
```

- `deliveredAt` is `null` until the orchestrator injects the message into a prompt (for `hint`/`redirect`/`answer`) or inserts the question row (`question` is delivered on insert).
- `createdBy` is `null` for agent-authored messages (`kind = QUESTION`).

### `VerificationRun` (Spec C)

```graphql
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
```

- `output` is the last 200 lines of combined stdout+stderr. Full output is not retained.
- `exitCode = -1` indicates the command exceeded its `timeout_ms`. `exitCode = 127` means the binary was not found.

### `TaskProgress` (Spec D)

```graphql
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
```

Parsed from the agent's `progress.ndjson` file. `total` may change during a run as the agent discovers work.

### `WorkspaceSnapshot` & `SnapshotFileEntry` (Spec D)

```graphql
type WorkspaceSnapshot {
  id: ID!
  taskId: ID!
  agentRunId: ID
  statSummary: String!
  fileStatus: [SnapshotFileEntry!]!
  hasPatch: Boolean!
  capturedAt: String!
}

type SnapshotFileEntry {
  path: String!
  status: String!            # "A", "M", "D", "R..."
  additions: Int!
  deletions: Int!
}
```

- The raw patch blob is **not** included on the type; fetch it on demand via the `workspaceSnapshotPatch(id)` query.
- `hasPatch = false` when the disk-budget guardrail (10 MB accumulated patch bytes per task) is active; only stat and file-status remain available.

### `VerifyCommand` (Spec C)

```graphql
type VerifyCommand {
  label: String!
  run: String!
  timeoutMs: Int
}
```

Used in `Task.verifyCommandsOverride`.

### `Playbook` & `PlaybookVersion` (Spec F)

```graphql
type Playbook {
  id: ID!
  name: String!
  displayName: String!
  description: String!
  currentVersion: PlaybookVersion!
  versions: [PlaybookVersion!]!
  archived: Boolean!
  createdBy: User!
  createdAt: String!
}

type PlaybookVersion {
  id: ID!
  versionNumber: Int!
  promptTemplate: String!
  defaultsJson: String!
  allowedToolsOverride: [String!]
  createdBy: User!
  createdAt: String!
}
```

- `versions` is ordered newest -> oldest.
- `defaultsJson` is a JSON string (forward-compatible schema); today it may contain `target_branch`, `tags`, `verify_commands`, `time_box_ms`.
- `allowedToolsOverride`, when set, replaces `claude.allowed_tools` from `WORKFLOW.md` for runs dispatched via this playbook version.
- Editing a playbook creates a new immutable `PlaybookVersion` row; prior `agent_runs.playbook_version_id` rows keep pointing to their original version.

### `BoardSecret` & `TaskSecret` (Spec H)

```graphql
type BoardSecret {
  id: ID!
  name: String!
  description: String
  createdBy: User!
  createdAt: String!
  updatedAt: String!
}

type TaskSecret {
  id: ID!
  name: String!
  createdBy: User!
  createdAt: String!
  updatedAt: String!
}
```

Plaintext values and encrypted ciphertext are **never** exposed through GraphQL -- only names and metadata. The agent subprocess receives resolved plaintext values under each secret's declared name (not under `HIVEBOARD_*`).

---

## 6. Enums

### `AgentStatus`

```graphql
enum AgentStatus {
  IDLE
  QUEUED
  RUNNING
  BLOCKED
  MISSING_SECRETS
  SUCCESS
  FAILED
}
```

State transitions:

- Baseline flow: `IDLE` -> `QUEUED` -> `RUNNING` -> `SUCCESS` | `FAILED` -> (back to `IDLE` via `cancelAgent` or re-dispatch).
- `RUNNING` -> `BLOCKED` (Spec B/E): agent exited cleanly and wrote `$HIVEBOARD_QUESTION`, **or** the time-box expired, **or** a blocker task failed (via cascade). Disambiguated by `Task.blockReason`.
- `BLOCKED` -> `QUEUED` (Spec B): `answerQuestion` mutation, or `extendTimeBox`, or manual intervention.
- `QUEUED` -> `MISSING_SECRETS` (Spec H): orchestrator tried to spawn but one or more declared `requiredSecrets` could not be resolved. Transitions back to `QUEUED` automatically when the missing secret is set at the task or board level.

### `BlockReason` (Spec B/E)

```graphql
enum BlockReason {
  QUESTION           # Spec B — agent wrote $HIVEBOARD_QUESTION
  TIMEOUT            # Spec E — time_box_ms exceeded
  DEPENDENCY_FAILED  # Spec E — a blocker task transitioned to FAILED
}
```

### `MessageKind` (Spec B)

```graphql
enum MessageKind {
  HINT       # human -> agent, non-urgent
  REDIRECT   # human -> agent, aborts the run
  QUESTION   # agent -> human, triggers BLOCKED
  ANSWER     # human -> agent, resumes a BLOCKED task
}
```

### `MessageAuthorType` (Spec B)

```graphql
enum MessageAuthorType {
  HUMAN
  AGENT
}
```

### `ProgressStatus` (Spec D)

```graphql
enum ProgressStatus {
  IN_PROGRESS
  DONE
  FAILED
}
```

> **Breaking change:** the `BoardAction` enum has been **removed**. The `Task.action` field and the `runAgent(action: ...)` argument are now plain `String`s. Use `"plan"`, `"implement"`, `"revise"`, or `"playbook:<name>"`. External clients that previously unioned the enum must update to string handling. (Spec F)

---

## 7. Input Types

### `CreateTaskInput`

```graphql
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
```

- `columnId` -- optional; defaults to the first column in the board.
- `targetBranch` -- optional; defaults to `"main"` in the resolver.
- `tagIds` -- optional; IDs must belong to the same board.
- `sessionId` -- opaque client-supplied identifier used for optimistic-UI deduplication.

### `UpdateTaskInput`

```graphql
input UpdateTaskInput {
  title: String
  body: String
  agentInstruction: String
  targetRepo: String
  targetBranch: String
  tagIds: [ID!]
}
```

All fields are optional. Only provided fields are updated. Passing `tagIds` replaces the full tag set (same semantics as `setTaskTags`).

### `CreateTagInput`

```graphql
input CreateTagInput {
  boardId: ID!
  name: String!
  color: String
}
```

`color` defaults to `"#aaaaaa"`; must match the hex-color regex.

### `VerifyCommandInput` (Spec C)

```graphql
input VerifyCommandInput {
  label: String!
  run: String!
  timeoutMs: Int
}
```

Used by `setTaskVerifyCommands`.

### `CreatePlaybookInput` & `UpdatePlaybookInput` (Spec F)

```graphql
input CreatePlaybookInput {
  name: String!
  displayName: String!
  description: String!
  promptTemplate: String!
  defaultsJson: String
  allowedToolsOverride: [String!]
}

input UpdatePlaybookInput {
  displayName: String
  description: String
  promptTemplate: String
  defaultsJson: String
  allowedToolsOverride: [String!]
}
```

`name` is only set on create and must match `/^[a-z0-9]+(-[a-z0-9]+)*$/`. Updates create a new `PlaybookVersion`; `name` is immutable post-create to preserve dispatch-URL stability.

---

## 8. Error Codes

Mutations throw `GraphQLError` with an `extensions.code` field. Known codes (not exhaustive -- built-ins like `BAD_USER_INPUT`, `UNAUTHENTICATED`, `FORBIDDEN` also appear):

| Code | Where | Meaning |
|---|---|---|
| `BAD_USER_INPUT` | various | Input validation failure (color format, GitHub username regex, non-positive durations, etc.). |
| `DEPENDENCY_SELF` | `addTaskDependency` | `taskId === blockerId`. |
| `DEPENDENCY_CROSS_BOARD` | `addTaskDependency` | Blocker is on a different board. |
| `DEPENDENCY_CYCLE` | `addTaskDependency` | Adding the edge would close a cycle. |
| `TASK_NOT_BLOCKED` | `answerQuestion` | Task is not in `BLOCKED` state with a pending question. |
| `TASK_NOT_FAILED` | `continueFailedTask` | Task is not in `FAILED` state. |
| `TIME_BOX_NOT_EXPIRED` | `extendTimeBox` | Task is not `BLOCKED` with `blockReason === TIMEOUT`. |
| `PLAYBOOK_NOT_FOUND` | `runAgent`, `updatePlaybook`, `archivePlaybook`, `unarchivePlaybook` | Playbook with the given name/id does not exist. |
| `PLAYBOOK_ARCHIVED` | `runAgent`, `unarchivePlaybook` | Playbook exists but is archived. |
| `PLAYBOOK_NAME_TAKEN` | `createPlaybook` | Another playbook already uses that name. |
| `SECRET_NAME_INVALID` | `setBoardSecret`, `setTaskSecret`, `setTaskRequiredSecrets` | Name does not match `/^[A-Z_][A-Z0-9_]*$/`. |
| `SECRET_VALUE_EMPTY` | `setBoardSecret`, `setTaskSecret` | `value` is empty. |
| `SECRETS_DISABLED` | any secret mutation | `HIVEBOARD_SECRETS_KEY` env var is not set at boot; feature is inert. |
| `SECRETS_UNREADABLE` | spawn-time resolution | Ciphertext could not be decrypted (key rotated, row corrupt, or tampered). Treated identically to "missing" for scheduling purposes but surfaces a distinct error when a value read is attempted. |

---

## 9. PubSub Channels (Internal Reference)

> Defined in [`packages/api/src/pubsub.ts`](../packages/api/src/pubsub.ts). Channel names are internal; GraphQL clients only see the subscription field names in Section 4.

| Channel | Scope Key | Payload | Published By |
|---|---|---|---|
| `TASK_UPDATED` | `boardId` | Full `Task` object | Every mutation that mutates a task (create/update/move/archive/unarchive/dispatch/cancel/answer/redirect/extend/kill/secrets); orchestrator state transitions |
| `AGENT_LOG` | `taskId` | `AgentLogChunk` | Orchestrator (via `publishAgentLog`) -- raw stdout chunks from the Claude CLI |
| `COMMENT_ADDED` | `taskId` | `Comment` | `addComment` |
| `COMMENT_UPDATED` | `taskId` | `Comment` | `updateComment` |
| `TASK_EVENT` | `taskId` | `TaskEvent` | Every mutation that records an event; orchestrator state transitions |
| `SCRATCHPAD_UPDATED` (Spec A) | `taskId` | `ScratchpadChunk` | fs watcher on `scratchpad.md` (debounced 250 ms) |
| `TASK_MESSAGE` (Spec B) | `taskId` | `TaskMessage` | `sendHint`, `sendRedirect`, `answerQuestion`, orchestrator on `question` detection |
| `VERIFICATION_RUN` (Spec C) | `taskId` | `VerificationRun` | Orchestrator verification loop, one publish per command |
| `TASK_PROGRESS` (Spec D) | `taskId` | `TaskProgress` | fs watcher on `progress.ndjson` (debounced 100 ms) |
| `WORKSPACE_SNAPSHOT` (Spec D) | `taskId` | `WorkspaceSnapshot` | Orchestrator snapshot loop (every 15 s during `RUNNING`, dedup'd by stat-hash) |
| `AGENT_CHECKPOINT` (Spec G) | `taskId` | `AgentRunCheckpoint` | Runner's NDJSON line parser, once per agent turn |
| `TASK_MISSING_SECRETS_CHANGED` (Spec H) | `taskId` | `{ taskId, missingSecrets: [String!]! }` | Orchestrator when a task's computed `missingSecrets` set changes |

### Helper functions (exported from `pubsub.ts`)

| Function | Signature |
|---|---|
| `publishTaskUpdated` | `(boardId: string, task: unknown) => void` |
| `publishAgentLog` | `(taskId: string, chunk: { taskId, chunk, timestamp }) => void` |
| `publishCommentAdded` | `(taskId: string, comment: unknown) => void` |
| `publishTaskEvent` | `(taskId: string, event: unknown) => void` |
| `publishScratchpadUpdated` | `(taskId: string, payload: { taskId, content, updatedAt }) => void` |
| `publishMessageAdded` | `(taskId: string, message: unknown) => void` |
| `publishVerificationRun` | `(taskId: string, run: { id, taskId, agentRunId, command, label, exitCode, output, startedAt, finishedAt }) => void` |
| `publishWorkspaceSnapshot` | `(taskId: string, snapshot: { id, taskId, agentRunId, statSummary, fileStatus, hasPatch, capturedAt }) => void` |
| `publishTaskProgress` | `(taskId: string, entry: { taskId, agentRunId, ts, step, total, label, detail, status }) => void` |
| `publishCheckpointAdded` | `(taskId: string, payload: { id, agentRunId, taskId, turn, kind, summary, rawBytes, occurredAt }) => void` |
| `publishTaskMissingSecretsChanged` | `(taskId: string, missing: string[]) => void` |
