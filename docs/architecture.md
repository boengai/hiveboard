# Architecture

> Last updated: 2026-03-21

HiveBoard is a local-first Kanban board that orchestrates autonomous coding agents.
Tasks live in a SQLite database on your machine; agents (Claude CLI) run against
cloned repositories and open PRs on GitHub. There is no cloud dependency beyond
GitHub as the code host.

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Browser  (localhost:5173)                                  │
│  React 19 + Vite + TanStack Router + Tailwind + Zustand    │
│                                                             │
│  Board View  ·  Task Drawer  ·  Agent Log Viewer            │
└───────┬───────────────────────────────┬─────────────────────┘
        │  GraphQL (queries/mutations)  │  SSE (subscriptions)
        ▼                               ▼
┌───────────────────────────────────────────────────────────────┐
│  API Server  (localhost:8080)                                 │
│  Bun + GraphQL Yoga                                          │
│                                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │  Resolvers   │  │ Orchestrator │  │  GitHub PR Client    │ │
│  │  (CRUD)      │  │ (poll+dispatch)│ │  (token / App auth) │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬──────────┘ │
│         │                 │                      │            │
│         ▼                 ▼                      │            │
│  ┌────────────────────────────┐                  │            │
│  │  Bun:sqlite  (WAL mode)   │                  │            │
│  │  tmp/database/hiveboard.db │                  │            │
│  └────────────────────────────┘                  │            │
│                                                  │            │
│         ┌────────────────────────┐               │            │
│         │  Claude CLI subprocess │◄──────────────┘            │
│         │  (per-task workspace)  │                            │
│         │  tmp/workspaces/       │                            │
│         └────────────────────────┘                            │
└───────────────────────────────────────────────────────────────┘
```

**Key insight:** The API server is *both* a GraphQL API for the web client and an
agent orchestrator. The orchestrator polls the database for queued tasks and
dispatches Claude CLI processes in isolated workspace directories.

---

## 2. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Runtime | **Bun** v1.1+ | Fast startup, native SQLite driver, built-in TS support |
| API | **GraphQL Yoga** | Lightweight, Bun-compatible, built-in SSE subscriptions |
| Database | **Bun:sqlite** (WAL mode) | Zero-dependency embedded DB; WAL allows concurrent reads during agent writes |
| Schema validation | **Zod v4** | Config validation for WORKFLOW.md front matter |
| Frontend | **React 19 + Vite** | Fast HMR, standard ecosystem |
| Routing | **TanStack Router** | Type-safe file-based routing |
| State | **Zustand** | Minimal boilerplate store for board state and optimistic updates |
| Styling | **Tailwind CSS + tailwind-variants** | Utility-first; `tv()` for component variant composition |
| Monorepo | **Bun workspaces** | `packages/api` + `packages/web` in one repo |
| Linting | **Biome** | Single tool for formatting + linting, fast |
| Agent | **Claude CLI** | Subprocess per task, streamed output |
| Code host | **GitHub** | PR creation, review comment fetching, issue management |

---

## 3. Data Flow Diagrams

### 3.1 Query / Mutation Flow

```
Browser                        API Server                     SQLite
  │                               │                              │
  │── POST /graphql ─────────────►│                              │
  │   { query: board(id) }        │── SELECT * FROM boards ─────►│
  │                               │◄── row data ─────────────────│
  │◄── JSON response ─────────────│                              │
  │                               │                              │
  │── POST /graphql ─────────────►│                              │
  │   { mutation: moveTask }      │── UPDATE tasks SET ──────────►│
  │                               │   column_id, position        │
  │                               │── pubsub.publish ──┐         │
  │◄── JSON response ─────────────│                    │         │
  │                               │                    ▼         │
  │◄── SSE: taskUpdated ──────────│◄─ TASK_UPDATED ────┘         │
```

### 3.2 Real-Time SSE Subscription Flow

GraphQL Yoga uses **Server-Sent Events** (SSE) for subscriptions — no WebSocket
server required.

```
Browser                                    API Server
  │                                           │
  │── GET /graphql?query=subscription ───────►│
  │   taskUpdated(boardId) or                 │
  │   agentLogStream(taskId)                  │
  │                                           │
  │◄── Content-Type: text/event-stream ───────│
  │                                           │
  │    ┌──────────────────────────────────┐   │
  │    │  PubSub topics:                  │   │
  │    │  • TASK_UPDATED  (by boardId)    │   │
  │    │  • AGENT_LOG     (by taskId)     │   │
  │    │  • COMMENT_ADDED (by taskId)     │   │
  │    │  • TASK_EVENT    (by taskId)     │   │
  │    └──────────────────────────────────┘   │
  │                                           │
  │◄── data: { taskUpdated: {...} } ──────────│  (on each publish)
  │◄── data: { agentLogStream: {...} } ───────│
  │    ...                                    │
```

The frontend Zustand store merges incoming `taskUpdated` events via
`mergeTaskUpdate()`, which removes the task from its old column and inserts it
(sorted by position) into the target column. This enables real-time board
updates as agents move tasks through columns.

### 3.3 Agent Execution Lifecycle

```
                         Orchestrator.poll()
                               │
                               ▼
              ┌────────────────────────────────┐
              │  SELECT * FROM tasks           │
              │  WHERE agent_status = 'queued' │
              │  ORDER BY updated_at ASC       │
              │  LIMIT (max_concurrent - running)│
              └───────────────┬────────────────┘
                              │
               (for each queued task)
                              │
                              ▼
              ┌────────────────────────────────┐
              │  1. SET agent_status = 'running'│
              │  2. INSERT task_events          │
              │     (agent_started)             │
              │  3. INSERT agent_runs           │
              │     (status = 'running')        │
              │  4. Move task to "In Progress"  │
              │     (skip for plan/research)    │
              │  5. pubsub → TASK_UPDATED       │
              └───────────────┬────────────────┘
                              │
                              ▼
              ┌────────────────────────────────┐
              │  Create workspace:             │
              │  tmp/workspaces/{repo}/task-*  │
              │  Run after_create hook         │
              │  (git clone + checkout branch) │
              └───────────────┬────────────────┘
                              │
                              ▼
              ┌────────────────────────────────┐
              │  Spawn Claude CLI subprocess   │
              │  Stream output → AGENT_LOG     │
              │  (via pubsub, SSE to browser)  │
              └───────────────┬────────────────┘
                              │
                    ┌─────────┴──────────┐
                    ▼                    ▼
              ┌───────────┐       ┌────────────┐
              │  SUCCESS  │       │  FAILURE   │
              └─────┬─────┘       └──────┬─────┘
                    │                    │
                    ▼                    ▼
          ┌──────────────────┐  ┌──────────────────┐
          │ Parse PR URL     │  │ Schedule retry   │
          │ Move to column:  │  │ Exponential      │
          │  plan → Todo     │  │ backoff:         │
          │  implement →     │  │ 10s × 2^attempt  │
          │    Review        │  │ (max 5 min)      │
          │  research →      │  │                  │
          │    stays         │  │ Re-queue task    │
          │ Publish [DONE]   │  │ after delay      │
          └──────────────────┘  └──────────────────┘
```

**Agent actions and their column transitions:**

| Action | On success, move to | Creates PR? |
|--------|-------------------|-------------|
| `plan` | Todo | No |
| `research` | *(stays in place)* | No |
| `implement` | Review | Yes |
| `revise` | Review | Yes (pushes to existing) |

---

## 4. Database ER Diagram

All 7 tables, with primary keys, foreign keys, and indexes.

```
┌───────────────┐
│    users      │
├───────────────┤
│ id       (PK) │
│ username  (UQ) │
│ display_name   │
│ role           │
│ created_at     │
└───────┬───────┘
        │ 1
        │
        ├──────────────────────────────┐
        │                              │
        ▼ N                            ▼ N
┌───────────────┐              ┌───────────────────┐
│    boards     │              │   task_comments    │
├───────────────┤              ├───────────────────┤
│ id       (PK) │              │ id        (PK)    │
│ name           │              │ task_id   (FK)───►tasks.id
│ created_by(FK)─┘              │ parent_id (FK)───►self (threaded)
│ created_at     │              │ body              │
│ updated_at     │              │ created_by(FK)───►users.id
└───────┬───────┘              │ created_at        │
        │ 1                    │ updated_at        │
        │                      └───────────────────┘
        ├──────────────────┐          ▲
        │                  │          │
        ▼ N                ▼ N        │
┌───────────────┐  ┌─────────────────────────────┐
│   columns     │  │          tasks               │
├───────────────┤  ├─────────────────────────────┤
│ id       (PK) │  │ id            (PK)           │
│ board_id (FK)──┘  │ board_id      (FK)──►boards │
│ name           │  │ column_id     (FK)──►columns│
│ position  (INT)│  │ title                       │
│ created_at     │  │ body                        │
└───────────────┘  │ position       (REAL)        │
                   │ action                       │
                   │ target_repo                  │
                   │ target_branch  (default main)│
                   │ agent_status   (default idle)│
                   │ agent_output                 │
                   │ agent_error                  │
                   │ retry_count    (default 0)   │
                   │ pr_url                       │
                   │ pr_number                    │
                   │ archived       (default 0)   │
                   │ archived_at                  │
                   │ created_by     (FK)──►users  │
                   │ updated_by     (FK)──►users  │
                   │ created_at                   │
                   │ updated_at                   │
                   └──────────┬──────────────────┘
                              │ 1
                    ┌─────────┼──────────┐
                    │         │          │
                    ▼ N       ▼ N        ▼ N
           ┌──────────────┐ ┌──────────────┐ (task_comments above)
           │ task_events   │ │ agent_runs   │
           ├──────────────┤ ├──────────────┤
           │ id      (PK)  │ │ id      (PK)  │
           │ task_id (FK)  │ │ task_id (FK)  │
           │ actor         │ │ action        │
           │ type          │ │ status        │
           │ data   (JSON) │ │ output        │
           │ created_at    │ │ error         │
           └──────────────┘ │ started_at    │
                            │ finished_at   │
                            └──────────────┘
```

**Indexes:**

| Index | Columns |
|-------|---------|
| `idx_tasks_board_column` | `tasks(board_id, column_id)` |
| `idx_tasks_agent_status` | `tasks(agent_status)` |
| `idx_task_events_task` | `task_events(task_id, created_at)` |
| `idx_task_comments_task` | `task_comments(task_id)` |
| `idx_agent_runs_task` | `agent_runs(task_id)` |

**Key constraints:**

- All IDs are `TEXT` (UUIDs generated at insert time).
- `boards`, `tasks`, and `task_comments` cascade-delete via `ON DELETE CASCADE`.
- `columns` cascade-delete when their parent board is deleted.
- All timestamps are ISO 8601 strings via `datetime('now')`.

---

## 5. Position Strategy

Task ordering within a column uses a **REAL-valued position** with a gap of
**1024** between items.

| Operation | Position calculation |
|-----------|-------------------|
| New task (append) | `max(position) + 1024`, or `0` if column is empty |
| Drop at top | `firstTask.position - 1024` |
| Drop between two tasks | `(prev.position + next.position) / 2` (fractional midpoint) |
| Drop at bottom | `lastTask.position + 1024` |

This approach avoids rewriting every row on reorder. The large gap (1024) means
you can do approximately 10 levels of bisection before positions become close
enough to warrant a rebalance. Column `position` is `INTEGER` (simple ordinal),
while task `position` is `REAL` to support fractional inserts.

---

## 6. Auth Model

**MVP: single-user, no authentication.**

A seed user called **`queen-bee`** (role: `admin`) is created automatically
during database migration. Every GraphQL mutation resolves the current user by
looking up `queen-bee`:

```
const user = db.query("SELECT * FROM users WHERE username = ?")
              .get('queen-bee')
```

There is no login, no session, no token verification. The `users` table exists
to support a future multi-user model, but for now every action is attributed to
the queen-bee user.

> **Security note:** HiveBoard is designed for trusted local environments only.
> Do not expose the API server to the public internet without adding
> authentication.

---

## 7. Configuration System

Configuration comes from two sources:

### 7.1 WORKFLOW.md (agent config + prompt template)

`WORKFLOW.md` uses **YAML front matter** (delimited by `---`) parsed by the
`yaml` library and validated with a Zod schema (`ConfigSchema`). Everything
below the closing `---` is the **prompt template** sent to Claude CLI, with
Mustache-style `{{ variable }}` interpolation.

```yaml
---
polling:
  interval_ms: 30000
workspace:
  root: ./tmp/workspaces
  ttl_ms: 259200000        # 72h stale workspace cleanup
claude:
  command: claude
  model: opus
  max_turns: 200
  permission_mode: bypassPermissions
  allowed_tools: [Bash, Read, Write, Edit, Glob, Grep]
agent:
  max_concurrent_agents: 5
  max_retry_backoff_ms: 300000
hooks:
  after_create: >-
    git clone --depth 1 ... && git checkout -b task-{{ task.short_id }}/{{ task.slug }}
---
(prompt template follows)
```

**Config sections:**

| Section | Key fields | Defaults |
|---------|-----------|----------|
| `polling` | `interval_ms` | 5000 |
| `workspace` | `root`, `ttl_ms` | `./workspaces`, 72h |
| `claude` | `command`, `model`, `max_turns`, `allowed_tools`, `permission_mode` | `claude`, -, 200, -, - |
| `agent` | `max_concurrent_agents`, `max_retry_backoff_ms` | 5, 300000 |
| `hooks` | `after_create`, `before_run`, `after_run`, `before_remove`, `timeout_ms` | -, -, -, -, 60000 |

Environment variable references (`$ENV_VAR`) in string values are resolved at
parse time. The orchestrator starts best-effort: if `WORKFLOW.md` is missing or
invalid, the API server still runs (you just cannot dispatch agents).

### 7.2 .env (secrets and ports)

Standard dotenv file for secrets and runtime overrides:

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `GITHUB_TOKEN` | Yes* | - | Personal access token (`repo` scope) |
| `GITHUB_APP_ID` | Alt* | - | GitHub App authentication |
| `GITHUB_APP_PRIVATE_KEY` | Alt* | - | GitHub App private key |
| `GITHUB_APP_INSTALLATION_ID` | Alt* | - | GitHub App installation ID |
| `API_PORT` | No | `8080` | API server port |
| `WEB_PORT` | No | `5173` | Vite dev server port |
| `DATABASE_PATH` | No | `tmp/database/hiveboard.db` | SQLite file location |
| `WORKFLOW_MD` | No | `WORKFLOW.md` | Path to workflow file |

*Either `GITHUB_TOKEN` or the three `GITHUB_APP_*` variables must be set.

---

## 8. GraphQL API Surface

**Queries:** `board`, `boards`, `task`, `agentRuns`, `taskTimeline`, `comments`, `me`

**Mutations:** `createBoard`, `createTask`, `updateTask`, `moveTask`,
`archiveTask`, `unarchiveTask`, `addComment`, `updateComment`, `deleteComment`,
`dispatchAgent`, `cancelAgent`

**Subscriptions (SSE):** `taskUpdated`, `agentLogStream`, `commentAdded`,
`taskEventAdded`

The endpoint is `POST /graphql` for queries and mutations, and
`GET /graphql?query=subscription{...}` for SSE subscriptions. A `/health`
endpoint returns `{ ok: true, uptime: N }`.

In production mode (`NODE_ENV=production`), the API also serves the built web
frontend from `packages/web/dist/` with SPA fallback.

---

## Cross-References

- [maintainer-guide.md](./maintainer-guide.md) -- Operational procedures, deployment, and troubleshooting.
- [conventions.md](./conventions.md) -- Code style, naming, component patterns.
- [api-reference.md](./api-reference.md) -- Full GraphQL schema documentation.
