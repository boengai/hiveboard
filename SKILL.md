# HiveBoard GraphQL API Skill

HiveBoard is a Kanban-style project management tool with built-in AI agent orchestration per task. Agents can be plain `plan` / `implement` / `revise` actions, or named `playbook:<name>` recipes. Tasks can have dependencies, time-boxes, per-task secrets, and a two-way message channel with the agent.

**Endpoint:** `{{HIVEBOARD_URL}}/graphql`

All requests use standard GraphQL over HTTP POST with a JSON body: `{ "query": "...", "variables": {...} }`. Subscriptions are served over SSE at the same endpoint. Full reference lives in [docs/api-reference.md](docs/api-reference.md).

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
        blockReason
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
    secrets { id name description updatedAt }   # per-task secrets registry (names only; never plaintext)
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
    action                   # "plan" | "implement" | "revise" | "playbook:<name>"
    agentInstruction
    agentStatus              # IDLE | QUEUED | RUNNING | BLOCKED | SUCCESS | FAILED | MISSING_SECRETS
    blockReason              # QUESTION | TIMEOUT | DEPENDENCY_FAILED | null
    retryCount
    prUrl
    targetRepo
    targetBranch
    archived
    archivedAt

    # Cross-run agent memory (Spec A)
    scratchpad               # auto-loaded into every agent prompt; human-read-only here

    # Agent ↔ human channel (Spec B)
    messages {
      id authorType kind body deliveredAt
      createdBy { displayName } createdAt
    }
    currentQuestion { id body createdAt }   # non-null when BLOCKED-QUESTION

    # Scheduling (Spec E)
    parentTask { id title }
    subtasks { id title agentStatus }
    blockers { id title agentStatus }
    dependents { id title agentStatus }
    timeBoxMs
    timeBoxStartedAt
    timeBoxRemainingMs       # computed; null if RUNNING without a time box

    # Secrets (Spec H)
    requiredSecrets          # [String!] declared names; values never returned
    missingSecrets           # [String!] names not yet satisfied by task/board
    taskSecrets { id name createdAt updatedAt }

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

Drop fields you don't need — the shape above is the full surface.

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

`action` is NOT part of `UpdateTaskInput` — use `runAgent` to set the action and trigger the agent. Required secrets and time-box are set via their own mutations (see below).

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

## Archive / Unarchive

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
query Tags($boardId: ID!) { tags(boardId: $boardId) { id name color } }

mutation CreateTag($input: CreateTagInput!) {
  createTag(input: $input) { id name color }
}
# Variables: { "input": { "boardId": "<board-id>", "name": "bug", "color": "#e53e3e" } }

mutation DeleteTag($id: ID!, $boardId: ID!) { deleteTag(id: $id, boardId: $boardId) }

mutation SetTaskTags($taskId: ID!, $tagIds: [ID!]!) {
  setTaskTags(taskId: $taskId, tagIds: $tagIds) { id tags { id name color } }
}
```

## Comments

```graphql
query Comments($taskId: ID!) {
  comments(taskId: $taskId) {
    id body parentId
    replies { id body createdBy { displayName } createdAt }
    createdBy { displayName }
    createdAt updatedAt
  }
}

mutation AddComment($taskId: ID!, $body: String!, $parentId: ID) {
  addComment(taskId: $taskId, body: $body, parentId: $parentId) {
    id body createdAt createdBy { displayName }
  }
}

mutation UpdateComment($id: ID!, $body: String!) {
  updateComment(id: $id, body: $body) { id body updatedAt }
}

mutation DeleteComment($id: ID!) { deleteComment(id: $id) }
```

## Run an Agent

```graphql
mutation RunAgent($taskId: ID!, $action: String!, $instruction: String) {
  runAgent(taskId: $taskId, action: $action, instruction: $instruction) {
    id action agentInstruction agentStatus
  }
}
```

`action` is a plain `String`:
- `"plan"` / `"implement"` / `"revise"` — the built-in actions
- `"playbook:<name>"` — run a playbook recipe (e.g. `"playbook:bump-dep"`)

Sets the task's `action`, optionally updates `agentInstruction`, and queues the agent with a 15-second grace period. Fails if the agent is already `RUNNING` or `QUEUED`. Fails with `MISSING_SECRETS` if the task declares `required_secrets` that aren't yet available.

## Cancel a Running Agent

```graphql
mutation CancelAgent($taskId: ID!) {
  cancelAgent(taskId: $taskId) { id agentStatus }
}
```

## Continue a Failed Task

```graphql
mutation ContinueFailedTask($taskId: ID!, $instruction: String) {
  continueFailedTask(taskId: $taskId, instruction: $instruction) {
    id agentStatus retryCount
  }
}
```

Only valid when the task is `FAILED`. Increments `retry_count` so the next run sees a compact replay of the failing attempt in its prompt.

## Agent Runs (History)

```graphql
query AgentRuns($taskId: ID!) {
  agentRuns(taskId: $taskId) {
    id action status output error
    playbookVersionId         # null for built-in actions
    turnCount                 # from Spec G checkpoint capture; 0 if unsupported
    checkpoints { turn kind summary rawBytes occurredAt }   # structured trace
    startedAt finishedAt
  }
}
```

## Task Timeline

```graphql
query TaskTimeline($taskId: ID!) {
  taskTimeline(taskId: $taskId) {
    id type actor { displayName } isSystem data createdAt
  }
}
```

---

## Agent Messages (Spec B)

Mid-run communication: hint is non-urgent (agent polls the inbox file); redirect aborts the running agent and prepends the message to the next prompt; answer resumes a `BLOCKED-QUESTION` task with a 30-second grace window.

```graphql
mutation SendHint($taskId: ID!, $body: String!) {
  sendHint(taskId: $taskId, body: $body) { id kind body deliveredAt }
}

mutation SendRedirect($taskId: ID!, $body: String!) {
  sendRedirect(taskId: $taskId, body: $body) { id kind body deliveredAt }
}

mutation AnswerQuestion($taskId: ID!, $body: String!) {
  answerQuestion(taskId: $taskId, body: $body) { id kind body }
}
```

`answerQuestion` rejects with `TASK_NOT_BLOCKED` when the task isn't in a `BLOCKED` state with an open question.

---

## Task Dependencies (Spec E)

```graphql
mutation AddTaskDependency($taskId: ID!, $blockerId: ID!) {
  addTaskDependency(taskId: $taskId, blockerId: $blockerId) {
    id blockers { id title agentStatus }
  }
}

mutation RemoveTaskDependency($taskId: ID!, $blockerId: ID!) {
  removeTaskDependency(taskId: $taskId, blockerId: $blockerId) { id }
}
```

Errors: `DEPENDENCY_CYCLE`, `DEPENDENCY_SELF`, `DEPENDENCY_CROSS_BOARD`. On blocker `FAILED`, dependents auto-transition to `BLOCKED` with `block_reason='DEPENDENCY_FAILED'`.

Subtasks are agent-driven (via `$HIVEBOARD_SUBTASKS` manifest written during a run); there's no `createSubtask` mutation — the orchestrator materializes them from the manifest on agent exit.

---

## Time-Boxing (Spec E)

```graphql
mutation SetTimeBox($taskId: ID!, $timeBoxMs: Int) {
  setTimeBox(taskId: $taskId, timeBoxMs: $timeBoxMs) { id timeBoxMs }
}

mutation ExtendTimeBox($taskId: ID!, $additionalMs: Int!) {
  extendTimeBox(taskId: $taskId, additionalMs: $additionalMs) {
    id agentStatus timeBoxMs blockReason
  }
}

mutation KillTask($taskId: ID!) {
  killTask(taskId: $taskId) { id agentStatus }
}
```

`setTimeBox(null)` clears the box. `extendTimeBox` is only valid when the task is `BLOCKED` with `block_reason='TIMEOUT'` (rejects with `TIME_BOX_NOT_EXPIRED` otherwise).

---

## Playbooks (Spec F)

```graphql
query Playbooks {
  playbooks {
    id name displayName description archived
    currentVersion { id versionNumber createdAt createdBy { displayName } }
  }
}

mutation CreatePlaybook($input: CreatePlaybookInput!) {
  createPlaybook(input: $input) { id name currentVersion { versionNumber } }
}
# Variables input fields: name (lowercase-hyphen), displayName, description,
#   promptTemplate (Mustache), defaultsJson (optional), allowedToolsOverride (optional [String])

mutation UpdatePlaybook($id: ID!, $input: UpdatePlaybookInput!) {
  updatePlaybook(id: $id, input: $input) {
    id versions { id versionNumber createdAt }   # new version prepended
  }
}

mutation ArchivePlaybook($id: ID!) { archivePlaybook(id: $id) { id archived } }
mutation UnarchivePlaybook($id: ID!) { unarchivePlaybook(id: $id) { id archived } }
```

Seeded playbooks: `bump-dep`, `add-tests`, `triage-flake`, `security-review`. Dispatch via `runAgent(taskId, "playbook:bump-dep", instruction)`.

---

## Per-Task Secrets (Spec H)

Plaintext values are NEVER returned by any query — only names and metadata. Requires `HIVEBOARD_SECRETS_KEY` env var on the server; otherwise mutations reject with `SECRETS_DISABLED`.

```graphql
mutation SetBoardSecret($boardId: ID!, $name: String!, $value: String!, $description: String) {
  setBoardSecret(boardId: $boardId, name: $name, value: $value, description: $description) {
    id name description updatedAt
  }
}

mutation DeleteBoardSecret($boardId: ID!, $name: String!) {
  deleteBoardSecret(boardId: $boardId, name: $name)
}

mutation SetTaskSecret($taskId: ID!, $name: String!, $value: String!) {
  setTaskSecret(taskId: $taskId, name: $name, value: $value) {
    id name updatedAt
  }
}

mutation DeleteTaskSecret($taskId: ID!, $name: String!) {
  deleteTaskSecret(taskId: $taskId, name: $name)
}

mutation SetTaskRequiredSecrets($taskId: ID!, $names: [String!]!) {
  setTaskRequiredSecrets(taskId: $taskId, names: $names) {
    id requiredSecrets missingSecrets agentStatus
  }
}
```

Names must match `/^[A-Z_][A-Z0-9_]*$/`. Resolution order at spawn time: task override → board default → missing. Setting a missing secret auto-unblocks dependent tasks.

---

## Verification, Progress, Snapshots (reads)

These surfaces are mostly subscription-driven for live views; the queries below are for historical reads. Full reference: [docs/api-reference.md](docs/api-reference.md).

```graphql
query TaskProgress($taskId: ID!) {
  taskProgress(taskId: $taskId) { step total label status ts detail }
}

query WorkspaceSnapshot($id: ID!) {
  workspaceSnapshot(id: $id) {
    statSummary
    fileStatus { path status additions deletions }
    hasPatch capturedAt
  }
}

query WorkspaceSnapshotPatch($id: ID!) {
  workspaceSnapshotPatch(id: $id)   # decompressed unified diff, or "" if hasPatch=false
}

# verificationRuns are exposed via Task.verificationRuns
query TaskWithVerification($id: ID!) {
  task(id: $id) {
    verifyAttemptCount
    verificationRuns {
      id command label exitCode output startedAt finishedAt
    }
  }
}
```

---

## Real-Time Subscriptions (SSE)

| Subscription | Trigger |
|---|---|
| `taskUpdated(boardId: ID!)` | Any task change on a board |
| `agentLogStream(taskId: ID!)` | Live log chunks from a running agent |
| `scratchpadUpdated(taskId: ID!)` | Scratchpad file content changed |
| `messageAdded(taskId: ID!)` | New human/agent message on a task |
| `verificationRunAdded(taskId: ID!)` | Verification command finished (pass or fail) |
| `taskProgressAdded(taskId: ID!)` | Agent emitted a progress ping |
| `workspaceSnapshotAdded(taskId: ID!)` | Orchestrator captured a workspace diff snapshot |
| `checkpointAdded(taskId: ID!)` | Structured per-turn checkpoint from the active run |
| `taskMissingSecretsChanged(taskId: ID!)` | Task's `missingSecrets` set changed |
| `commentAdded(taskId: ID!)` | New comment on a task |
| `commentUpdated(taskId: ID!)` | Comment edited on a task |
| `taskEventAdded(taskId: ID!)` | Timeline event added to a task |

---

## Key Types

**AgentStatus enum**
- `IDLE` — no agent activity
- `QUEUED` — agent is waiting to run
- `RUNNING` — agent is actively executing
- `BLOCKED` — agent paused; see `blockReason` for why
- `MISSING_SECRETS` — task declares required secrets that aren't available
- `SUCCESS` — agent completed successfully
- `FAILED` — agent encountered an error

**BlockReason enum**
- `QUESTION` — agent wrote `$HIVEBOARD_QUESTION` and exited; see `Task.currentQuestion`
- `TIMEOUT` — time-box expired; extend or kill to proceed
- `DEPENDENCY_FAILED` — a blocker task failed

**`action` (string, not an enum)**
- `"plan"` / `"implement"` / `"revise"` — built-in actions
- `"playbook:<name>"` — named playbook recipe

**MessageKind enum** — `HINT`, `REDIRECT`, `QUESTION`, `ANSWER`
**MessageAuthorType enum** — `HUMAN`, `AGENT`
**ProgressStatus enum** — `IN_PROGRESS`, `DONE`, `FAILED`

**Task** — core work item in a Column. Has agent fields (`action`, `agentStatus`, `blockReason`, `retryCount`, `prUrl`), cross-run memory (`scratchpad`), message thread (`messages`, `currentQuestion`), scheduling (`parentTask`, `subtasks`, `blockers`, `dependents`, `timeBoxMs`), and secrets (`requiredSecrets`, `missingSecrets`, `taskSecrets`).

**TaskMessage** — `{id, authorType, kind, body, deliveredAt, createdBy, createdAt}`

**Playbook / PlaybookVersion** — named, versioned prompt recipe; editing creates a new version.

**BoardSecret / TaskSecret** — encrypted name-scoped secret; plaintext never exposed.

**VerificationRun** — per-command verification record with `command`, `label`, `exitCode`, `output`, timing.

**TaskProgress** — one agent-emitted step ping with `{step, total, label, status, detail, ts}`.

**WorkspaceSnapshot** — periodic `git diff` capture; `patch` fetched lazily via `workspaceSnapshotPatch(id)`.

**AgentRunCheckpoint** — one compact summary row per agent turn (from stream-json parsing).

**User / Board / Column / Tag / Comment / AgentRun / TaskEvent / AgentLogChunk** — unchanged from the pre-orchestration-wave shape.

See [docs/api-reference.md](docs/api-reference.md) for full field lists, input types, error codes, and pubsub channel details.
