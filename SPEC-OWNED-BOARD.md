# HiveBoard: Owned Board — Technical Spec

> **Branch:** `feat/owned-board`
> **Status:** Draft
> **Date:** 2026-03-18

## Overview

Replace the GitHub Projects V2 dependency with a **standalone Kanban board** that HiveBoard owns. The board becomes the primary interface — users create tasks on the board UI, and HiveBoard dispatches agents directly. GitHub is still the code host (PRs are created there), but the board, task state, and orchestration are fully self-contained.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Browser (localhost:5173)                           │
│  React + Vite + TanStack Router + Tailwind + Zustand│
│  ┌───────────┐ ┌──────────┐ ┌────────────────────┐ │
│  │ Board View│ │Task Drawer│ │ Agent Logs Viewer  │ │
│  └───────────┘ └──────────┘ └────────────────────┘ │
│         │  GraphQL + WebSocket (subscriptions)       │
└─────────┼───────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────┐
│  API Server (localhost:4000)                         │
│  Bun + GraphQL Yoga                                  │
│  ┌──────────┐ ┌────────────┐ ┌───────────────────┐ │
│  │ Resolvers│ │Orchestrator│ │ GitHub PR Client   │ │
│  └──────────┘ └────────────┘ └───────────────────┘ │
│         │            │                               │
│  ┌──────▼────────────▼──────┐                       │
│  │    Bun SQLite (local)    │                       │
│  │  tmp/database/hiveboard.db │                       │
│  └──────────────────────────┘                       │
└─────────────────────────────────────────────────────┘
```

## Monorepo Structure (Bun Workspaces)

```
hiveboard/
├── package.json              # root — workspaces: ["packages/*"]
├── packages/
│   ├── api/                  # GraphQL API server
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts          # entry — starts GraphQL Yoga server
│   │   │   ├── schema/
│   │   │   │   ├── typeDefs.ts   # GraphQL SDL
│   │   │   │   └── resolvers.ts  # Query/Mutation/Subscription resolvers
│   │   │   ├── db/
│   │   │   │   ├── schema.ts     # SQLite table definitions (CREATE TABLE)
│   │   │   │   ├── migrate.ts    # Auto-migration on startup
│   │   │   │   └── client.ts     # Bun SQLite singleton
│   │   │   ├── orchestrator/     # (moved from src/orchestrator/)
│   │   │   ├── agent/            # (moved from src/agent/)
│   │   │   ├── workspace/        # (moved from src/workspace/)
│   │   │   ├── github/           # slimmed — PR creation only
│   │   │   └── pubsub.ts         # in-memory pub/sub for subscriptions
│   │   └── tsconfig.json
│   └── web/                  # React frontend
│       ├── package.json
│       ├── index.html
│       ├── vite.config.ts
│       ├── src/
│       │   ├── main.tsx
│       │   ├── routes/
│       │   │   ├── __root.tsx    # TanStack root layout
│       │   │   └── index.tsx     # Board view (default route)
│       │   ├── components/
│       │   │   ├── Board.tsx         # Kanban board (columns + drag-drop)
│       │   │   ├── Column.tsx        # Single column
│       │   │   ├── TaskCard.tsx      # Card in column
│       │   │   ├── TaskDrawer.tsx    # Slide-over drawer for task detail
│       │   │   ├── TaskTimeline.tsx  # Activity timeline (events + comments interleaved)
│       │   │   ├── TimelineEvent.tsx # Single event row (icon + actor + description)
│       │   │   ├── TaskComments.tsx  # Comment input + threaded replies
│       │   │   ├── CreateTaskDialog.tsx
│       │   │   └── AgentLogStream.tsx # Live agent output
│       │   ├── store/
│       │   │   └── boardStore.ts     # Zustand store
│       │   ├── graphql/
│       │   │   ├── client.ts         # urql or graphql-request client
│       │   │   ├── queries.ts
│       │   │   ├── mutations.ts
│       │   │   └── subscriptions.ts
│       │   └── styles/
│       │       └── index.css         # Tailwind directives
│       └── tsconfig.json
├── src/                      # existing code (kept for migration, eventually removed)
├── WORKFLOW.md
└── tsconfig.json
```

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Bun | Already used, native SQLite, fast |
| Monorepo | Bun workspaces | Zero config, built-in |
| API framework | GraphQL Yoga | Bun-native, subscriptions via SSE/WS built-in |
| Database | Bun SQLite (`bun:sqlite`) | Zero dependency, embedded, fast |
| Frontend build | Vite | Fast HMR, Bun-compatible |
| Routing | TanStack Router | Type-safe, file-based routing |
| State | Zustand | Lightweight, minimal boilerplate |
| Styling | Tailwind CSS v4 | Utility-first, fast |
| Theme | GitHub Dark (dark default) | Familiar, high contrast, developer-friendly |
| Drag & drop | @dnd-kit/core | Lightweight, accessible |
| GraphQL client | urql | Lightweight, supports subscriptions |
| Real-time | GraphQL Subscriptions (SSE) | Built into Yoga, no extra server |

## Database Schema (Bun SQLite)

```sql
-- Users
CREATE TABLE users (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  username   TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member',  -- 'admin' | 'member'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Boards (future: multi-board support)
CREATE TABLE boards (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name       TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Columns within a board
CREATE TABLE columns (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tasks (replaces GitHub Issues as source of truth)
CREATE TABLE tasks (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  board_id       TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  column_id      TEXT NOT NULL REFERENCES columns(id),
  title          TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',
  position       INTEGER NOT NULL DEFAULT 0,
  -- action dispatch
  action         TEXT,          -- 'plan' | 'research' | 'implement' | 'implement-e2e' | 'revise' | NULL
  target_repo    TEXT,          -- 'owner/repo'
  -- agent state
  agent_status   TEXT NOT NULL DEFAULT 'idle',  -- 'idle' | 'queued' | 'running' | 'success' | 'failed'
  agent_output   TEXT,
  agent_error    TEXT,
  retry_count    INTEGER NOT NULL DEFAULT 0,
  -- github link
  pr_url         TEXT,
  pr_number      INTEGER,
  -- archive
  archived       INTEGER NOT NULL DEFAULT 0,   -- 0 = active, 1 = archived
  archived_at    TEXT,
  -- audit
  created_by     TEXT NOT NULL REFERENCES users(id),
  updated_by     TEXT NOT NULL REFERENCES users(id),
  -- timestamps
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Task comments
CREATE TABLE task_comments (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES task_comments(id) ON DELETE CASCADE,  -- NULL = top-level, set = reply
  body       TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Task activity timeline (like GitHub issue timeline)
-- Every meaningful change to a task is recorded here.
-- actor = 'SYSTEM' for orchestrator/agent actions, user id for human actions.
CREATE TABLE task_events (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor      TEXT NOT NULL,    -- user id or 'SYSTEM'
  type       TEXT NOT NULL,    -- event type (see below)
  data       TEXT,             -- JSON payload with event-specific details
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Event types & data payloads:
--   'created'          {}
--   'moved'            {"from_column": "Backlog", "to_column": "In Progress"}
--   'status_changed'   {"from": "idle", "to": "running"}
--   'action_set'       {"action": "implement"}
--   'action_cleared'   {"action": "implement"}
--   'assigned'         {"target_repo": "owner/repo"}
--   'comment_added'    {"comment_id": "..."}
--   'pr_opened'        {"pr_url": "...", "pr_number": 42}
--   'archived'         {}
--   'unarchived'       {}
--   'agent_started'    {"action": "implement", "retry": 0}
--   'agent_succeeded'  {"action": "implement", "duration_ms": 12345}
--   'agent_failed'     {"action": "implement", "error": "..."}
--   'title_changed'    {"from": "old title", "to": "new title"}
--   'body_changed'     {}

-- Agent run history
CREATE TABLE agent_runs (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  status      TEXT NOT NULL,   -- 'running' | 'success' | 'failed'
  output      TEXT,
  error       TEXT,
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
```

**Default seed on first run:**
- 1 user: `queen-bee` (role: admin, display_name: "Queen Bee")
- 1 board: "HiveBoard" (created_by: queen-bee)
- 5 columns: Backlog (0), Todo (1), In Progress (2), Review (3), Done (4)

## GraphQL Schema

```graphql
type Query {
  board(id: ID!): Board
  boards: [Board!]!
  task(id: ID!): Task
  agentRuns(taskId: ID!): [AgentRun!]!
  taskTimeline(taskId: ID!): [TaskEvent!]!  # unified activity feed
  comments(taskId: ID!): [Comment!]!
  me: User!
}

type Mutation {
  # Board
  createBoard(name: String!): Board!

  # Task CRUD
  createTask(input: CreateTaskInput!): Task!
  updateTask(id: ID!, input: UpdateTaskInput!): Task!
  deleteTask(id: ID!): Boolean!
  moveTask(id: ID!, columnId: ID!, position: Int!): Task!
  archiveTask(id: ID!): Task!
  unarchiveTask(id: ID!): Task!

  # Comments
  addComment(taskId: ID!, body: String!, parentId: ID): Comment!
  updateComment(id: ID!, body: String!): Comment!
  deleteComment(id: ID!): Boolean!

  # Agent dispatch
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
  createdBy: User!
  createdAt: String!
}

type Column {
  id: ID!
  name: String!
  position: Int!
  tasks: [Task!]!          # excludes archived by default
}

type Task {
  id: ID!
  title: String!
  body: String!
  column: Column!
  position: Int!
  action: String
  targetRepo: String
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
  type: String!              # 'created' | 'moved' | 'status_changed' | 'agent_started' | ...
  actor: User                # null when actor = 'SYSTEM'
  isSystem: Boolean!         # true when actor = 'SYSTEM'
  data: String               # JSON string with event-specific payload
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
}

input UpdateTaskInput {
  title: String
  body: String
  action: String
  targetRepo: String
}
```

## Frontend Views

### 1. Board View (`/`) — Single Page
- Kanban board with 5 columns
- Each column shows **active (non-archived) task cards** sorted by position
- Drag-and-drop cards between columns (via @dnd-kit)
- "+" button on each column to create a task
- Task cards show: title, action badge, agent status indicator, target repo, created_by avatar
- Real-time updates via subscription — cards move/update automatically when agents change state
- "Show Archived" toggle to reveal archived tasks (grayed out, not draggable)
- Current user shown in header (hardcoded `queen-bee` for MVP)
- **Dark theme** (GitHub Dark style): `#0d1117` background, `#161b22` surfaces, `#30363d` borders, `#e6edf3` text, `#238636` green accents, `#da3633` red accents

### 2. Task Drawer (slide-over panel, no page navigation)
- Opens as a right-side drawer when clicking a task card — board stays visible behind
- Full task view: title (editable), body (markdown editor), action selector, target repo input
- Agent status panel: current status, retry count, last error
- "Dispatch Agent" button (action selector dropdown: plan, research, implement, implement-e2e, revise)
- "Cancel Agent" button (when running)
- "Archive" / "Unarchive" button
- Agent log stream (live output from Claude CLI via subscription)
- PR link (when created)
- **Activity Timeline** (GitHub-issue-style, chronological feed):
  - Interleaves events and comments in a single vertical timeline
  - Each entry shows: icon + actor (or **SYSTEM** badge) + description + relative timestamp
  - User actions: "queen-bee moved this from Backlog to In Progress"
  - System actions (highlighted with SYSTEM badge):
    - "SYSTEM changed status to `running`"
    - "SYSTEM agent started (`implement`, attempt #1)"
    - "SYSTEM agent succeeded (took 2m 34s)"
    - "SYSTEM agent failed: <error summary>"
    - "SYSTEM opened PR #42"
  - Comments appear inline in the timeline with full threaded replies
  - New comment input at the bottom of the timeline
  - Real-time: new events/comments stream in via subscription
- Shows "Created by" and "Updated by" user info
- Close drawer with X button or clicking outside

## Agent Orchestration Changes

The orchestrator moves from polling GitHub Projects → polling the local SQLite database:

| Current (GitHub-based) | New (Owned Board) |
|------------------------|-------------------|
| Poll GitHub Projects V2 via GraphQL | Query `tasks` table for `agent_status = 'queued'` |
| Parse `action:*` / `repo:*` labels | Read `action` and `target_repo` columns directly |
| Move column via GitHub GraphQL mutation | `UPDATE tasks SET column_id = ?` |
| Add `status:running` label | `UPDATE tasks SET agent_status = 'running'` |
| Post comment on issue | `INSERT INTO task_events` + publish subscription |
| Create PR on GitHub | **Still uses GitHub API** — `gh pr create` |

### Dispatch Flow (new)

```
1. User creates task on board, sets action + target_repo
   → event: {type: 'created', actor: user_id}
2. User clicks "Dispatch Agent" → mutation sets agent_status = 'queued'
   → event: {type: 'status_changed', actor: user_id, data: {from: 'idle', to: 'queued'}}
3. Orchestrator poll loop picks up queued tasks
4. Sets agent_status = 'running', publishes taskUpdated + taskEventAdded
   → event: {type: 'agent_started', actor: 'SYSTEM', data: {action, retry: 0}}
5. Spawns Claude CLI (same as current runner.ts)
6. Streams stdout to agentLogStream subscription
7. On success: agent_status = 'success', move to Review column, record agent_run
   → event: {type: 'agent_succeeded', actor: 'SYSTEM', data: {action, duration_ms}}
   → event: {type: 'moved', actor: 'SYSTEM', data: {from_column, to_column}}
8. On failure: agent_status = 'failed', record error, retry logic same as current
   → event: {type: 'agent_failed', actor: 'SYSTEM', data: {action, error}}
```

## Migration Strategy

Phased approach — existing code keeps working while we build alongside it:

1. **Phase 1 — Scaffold** monorepo, database, GraphQL server with basic CRUD
2. **Phase 2 — Frontend** board UI with drag-drop and task CRUD
3. **Phase 3 — Orchestrator** port orchestrator to use SQLite instead of GitHub Projects
4. **Phase 4 — Real-time** subscriptions for live task updates + agent log streaming
5. **Phase 5 — Cleanup** remove old webhook server and GitHub Projects polling code

## Dev Scripts

```json
// root package.json
{
  "scripts": {
    "dev": "bun run --filter '*' dev",
    "dev:api": "bun run --filter api dev",
    "dev:web": "bun run --filter web dev"
  }
}
```

- `bun run dev` — starts both API (4000) and Vite (5173) concurrently
- API: `bun --watch packages/api/src/index.ts`
- Web: `vite` (dev server with proxy to API)

---

## Acceptance Checklist

### Phase 1: Scaffold & Database
- [ ] Convert to Bun workspaces monorepo (`packages/api`, `packages/web`)
- [ ] Existing `src/` code still runs via `bun run start` (no breakage)
- [ ] `packages/api/src/db/` — Bun SQLite schema, auto-migration on startup
- [ ] `users` table with seed user `queen-bee` (role: admin)
- [ ] Default seed: 1 board "HiveBoard" with 5 columns (created_by: queen-bee)
- [ ] `task_comments` table with threaded replies (parent_id)
- [ ] GraphQL Yoga server starts on `localhost:4000`
- [ ] `task_events` table records all state changes with actor (`SYSTEM` or user id)
- [ ] All Query resolvers work: `boards`, `board`, `task`, `agentRuns`, `taskTimeline`, `comments`, `me`
- [ ] All Mutation resolvers work: `createBoard`, `createTask`, `updateTask`, `deleteTask`, `moveTask`, `archiveTask`, `unarchiveTask`, `addComment`, `updateComment`, `deleteComment`
- [ ] Every mutation that changes task state inserts a corresponding `task_events` row
- [ ] Tasks have `created_by` and `updated_by` fields (default: queen-bee)
- [ ] `action` field supports: `plan`, `research`, `implement`, `implement-e2e`, `revise`
- [ ] Column queries exclude archived tasks by default
- [ ] `bun test` passes for API (resolver + DB layer tests)

### Phase 2: Frontend Board UI
- [ ] Vite + React + TanStack Router + Tailwind + Zustand scaffolded
- [ ] Board view renders columns and task cards from GraphQL
- [ ] Drag-and-drop tasks between columns (position updates persisted)
- [ ] Create task dialog: title, body, action, target repo
- [ ] Task drawer (slide-over panel) opens on card click — no page navigation
- [ ] Edit task fields within drawer
- [ ] Delete task from drawer
- [ ] Archive / unarchive task from drawer
- [ ] "Show Archived" toggle on board (archived tasks shown grayed out)
- [ ] Activity timeline in drawer: events + comments interleaved chronologically
- [ ] SYSTEM events show with distinct badge (not user avatar)
- [ ] User events show actor name (e.g., "queen-bee moved this to In Progress")
- [ ] Comment thread within timeline: add, reply, edit, delete comments
- [ ] Task cards show action badge + agent status indicator + created_by
- [ ] Current user (queen-bee) shown in header
- [ ] Vite proxies `/graphql` to API server
- [ ] Dark theme matching GitHub Dark palette (bg `#0d1117`, surface `#161b22`, border `#30363d`)
- [ ] Responsive layout (works reasonably on different screen widths)

### Phase 3: Agent Orchestration
- [ ] Orchestrator reads from SQLite instead of GitHub Projects
- [ ] `dispatchAgent` mutation queues task for agent (supports `research` action)
- [ ] `cancelAgent` mutation aborts running agent
- [ ] Agent runner creates workspace, spawns Claude CLI (same as current)
- [ ] `research` action: agent researches codebase/topic, writes findings to task body (no PR)
- [ ] On success: update task status, move to Review column, record `agent_run`
- [ ] On failure: update task status, record error, retry with backoff
- [ ] PR creation still works via GitHub API (writes `pr_url` back to task)
- [ ] `bun test` passes for orchestrator logic

### Phase 4: Real-time
- [ ] `taskUpdated` subscription fires on any task mutation
- [ ] Board UI auto-updates cards when subscription fires (no manual refresh)
- [ ] `agentLogStream` subscription streams Claude CLI stdout chunks
- [ ] Task drawer shows live agent output
- [ ] `commentAdded` subscription updates comment thread in real-time
- [ ] `taskEventAdded` subscription streams new timeline events to drawer
- [ ] Agent status transitions visible in real-time on board + timeline

### Phase 5: Cleanup
- [ ] Remove old `src/webhook/` server code
- [ ] Remove GitHub Projects V2 polling code
- [ ] Remove `@octokit/webhooks` dependency
- [ ] Slim down `src/github/` to PR-creation-only client
- [ ] Update `WORKFLOW.md` config to remove GitHub Projects fields
- [ ] Update `README.md` with new setup instructions
- [ ] All tests pass, no dead code
