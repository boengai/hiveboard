# Maintainer Guide

This guide is for developers who need to modify or extend HiveBoard --- a local-first Kanban board backed by SQLite and a GraphQL API.

---

## Module Responsibility Table

All API source lives under `packages/api/src/`.

| Directory | Key files | Responsibility |
|---|---|---|
| `db/` | `client.ts`, `schema.ts`, `migrate.ts`, `seed.ts`, `ulid.ts` | SQLite connection (WAL mode, FK enforcement), table DDL, idempotent migrations, seed data, ULID-based ID generation |
| `schema/` | `typeDefs.ts`, `resolvers.ts` | GraphQL type definitions and all Query/Mutation/Subscription resolvers |
| `config/` | `schema.ts`, `loader.ts` | Zod validation schemas for `WORKFLOW.md` front matter; YAML parsing and env-var resolution |
| `orchestrator/` | `orchestrator.ts`, `singleton.ts` | Poll loop that picks up queued tasks, dispatches agents, manages concurrency, handles retry with exponential backoff, graceful shutdown |
| `agent/` | `runner.ts`, `prompt.ts` | Spawns Claude CLI per task, builds CLI args, renders Mustache prompt templates, streams stdout to pubsub |
| `workspace/` | `manager.ts`, `path-safety.ts` | Creates/removes per-task workspace directories, runs lifecycle hooks, TTL-based sweep, symlink-escape detection |
| `github/` | `client.ts` | GitHub client: App identity via `fetch` with JWT, PRs via `gh pr create`, review comments via `gh api` |
| `tunnel/` | *(empty --- reserved)* | Reserved for future Cloudflare tunnel integration |
| `pubsub.ts` | *(root file)* | Typed `graphql-yoga` PubSub instance with four channels: `TASK_UPDATED`, `AGENT_LOG`, `COMMENT_ADDED`, `TASK_EVENT` |

The frontend lives under `packages/web/src/`:

| Directory | Purpose |
|---|---|
| `components/common/` | Reusable UI primitives (Badge, Button, Drawer, Icon, Input, Markdown) |
| `components/feature/` | Domain components (agent, board, task) |
| `graphql/` | `graphql-request` client, query/mutation/subscription definitions |
| `store/` | Zustand stores (`boardStore.ts`) |
| `pages/` | Page-level components |
| `routes/` | TanStack Router route definitions |
| `types/` | Shared TypeScript types |
| `utils/` | Helper functions |

---

## How-To Recipes

### 1. Add a DB column

**Touch:** `schema.ts` -> `migrate.ts` -> `typeDefs.ts` -> `resolvers.ts`

#### Step 1 --- Add to `schema.ts`

Add the column to the `CREATE TABLE` statement in `packages/api/src/db/schema.ts`. This is the source of truth for fresh databases.

```ts
// packages/api/src/db/schema.ts
CREATE TABLE IF NOT EXISTS tasks (
  ...
  priority       TEXT DEFAULT 'medium',    -- new column
  ...
);
```

#### Step 2 --- Add migration in `migrate.ts`

Use the `ensureColumn()` helper so existing databases get the column. This is idempotent --- it checks `PRAGMA table_info` before altering.

```ts
// packages/api/src/db/migrate.ts
function addMissingColumns(db: Database): void {
  // ... existing columns ...
  ensureColumn(db, 'tasks', 'priority', "TEXT DEFAULT 'medium'")
}
```

To rename a column instead, use `renameColumn()`:

```ts
renameColumn(db, 'tasks', 'old_name', 'new_name')
```

#### Step 3 --- Expose in GraphQL schema

Add the field to the relevant type in `packages/api/src/schema/typeDefs.ts`:

```graphql
type Task {
  ...
  priority: String
}
```

If the column is writable, add it to the input types too:

```graphql
input CreateTaskInput {
  ...
  priority: String
}

input UpdateTaskInput {
  ...
  priority: String
}
```

#### Step 4 --- Update resolvers

1. Add the field to the `TaskRow` type alias in `resolvers.ts`.
2. Add the camelCase mapping in `mapTask()`:

```ts
function mapTask(row: TaskRow) {
  return {
    ...row,
    priority: row.priority,
    // ... existing mappings
  }
}
```

3. If writable, update `createTask` and `updateTask` mutations to include the column in their SQL statements.

---

### 2. Add a GraphQL mutation

**Touch:** `typeDefs.ts` -> `resolvers.ts` -> `pubsub.ts` (if real-time needed)

#### Step 1 --- Define in typeDefs

```graphql
# packages/api/src/schema/typeDefs.ts
type Mutation {
  ...
  assignTask(id: ID!, userId: ID!): Task!
}
```

#### Step 2 --- Implement resolver

Follow the existing pattern: get current user, validate, run SQL in a transaction, emit task events, publish to pubsub.

```ts
// packages/api/src/schema/resolvers.ts
Mutation: {
  assignTask(_: unknown, { id, userId }: { id: string; userId: string }) {
    const user = getCurrentUser()
    const existing = db
      .query('SELECT * FROM tasks WHERE id = ?')
      .get(id) as TaskRow | null
    if (!existing) throw new Error(`Task ${id} not found`)

    db.transaction(() => {
      db.run(
        `UPDATE tasks SET assigned_to = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
        [userId, user.id, id],
      )
      db.run(
        'INSERT INTO task_events (id, task_id, actor, type, data) VALUES (?, ?, ?, ?, ?)',
        [generateId(), id, user.id, 'assigned', JSON.stringify({ user_id: userId })],
      )
    })()

    const task = getTaskById(id)
    if (!task) throw new Error(`Task ${id} not found`)
    publishTaskUpdated(task)
    return task
  },
}
```

#### Step 3 --- Publish to pubsub (optional)

If the mutation should trigger real-time updates, call the appropriate pubsub helper:

```ts
pubsub.publish('TASK_UPDATED', boardId, task as unknown as Record<string, unknown>)
pubsub.publish('TASK_EVENT', taskId, eventPayload as unknown as Record<string, unknown>)
```

---

### 3. Add a subscription

**Touch:** `typeDefs.ts` -> `resolvers.ts` -> `pubsub.ts`

#### Step 1 --- Add channel to pubsub

```ts
// packages/api/src/pubsub.ts
export const pubsub = createPubSub<{
  // ... existing channels ...
  MY_NEW_CHANNEL: [scopeId: string, payload: Record<string, unknown>]
}>()
```

#### Step 2 --- Declare in typeDefs

```graphql
type Subscription {
  ...
  myNewEvent(boardId: ID!): MyPayloadType!
}
```

#### Step 3 --- Implement resolver

Subscriptions follow a `subscribe` + `resolve` pair:

```ts
Subscription: {
  myNewEvent: {
    subscribe(_: unknown, { boardId }: { boardId: string }) {
      return pubsub.subscribe('MY_NEW_CHANNEL', boardId)
    },
    resolve(payload: Record<string, unknown>) {
      return payload
    },
  },
}
```

The first argument to `pubsub.subscribe()` is the channel name; the second is the topic key (used to scope which clients receive events). Publish from any mutation or the orchestrator using `pubsub.publish('MY_NEW_CHANNEL', scopeId, payload)`.

---

### 4. Add a config field

**Touch:** `config/schema.ts` -> `WORKFLOW.md`

Config is defined as Zod schemas in `packages/api/src/config/schema.ts` and parsed from the YAML front matter in `WORKFLOW.md`.

#### Step 1 --- Add Zod field

```ts
// packages/api/src/config/schema.ts
export const AgentSchema = z.object({
  max_concurrent_agents: z.number().int().positive().default(5),
  max_retry_backoff_ms: z.number().int().positive().default(300_000),
  my_new_field: z.string().default('default_value'),  // new
})
```

For secrets that come from env vars, use the `_envString()` helper:

```ts
api_key: _envString(),  // resolves $MY_API_KEY from process.env
```

#### Step 2 --- Use in WORKFLOW.md

```yaml
---
agent:
  max_concurrent_agents: 3
  my_new_field: custom_value
---
```

The `objectWithDefaults()` wrapper ensures the entire section defaults gracefully if omitted.

#### Step 3 --- Access in code

All config fields are available via the `Config` type:

```ts
constructor(private config: Config) {
  console.log(config.agent.my_new_field)
}
```

---

### 5. Add an agent action

**Touch:** `resolvers.ts` (validation) -> `orchestrator.ts` (dispatch behavior) -> `WORKFLOW.md` (prompt template)

#### Step 1 --- Add to allowed actions

In `resolvers.ts`, the `dispatchAgent` mutation validates actions against a whitelist:

```ts
const validActions = [
  'idle', 'plan', 'research', 'implement', 'revise',
  'my-new-action',  // add here
]
```

#### Step 2 --- Define orchestrator behavior

In `orchestrator.ts`, actions control two things:

- **Column movement on dispatch:** `plan` and `research` stay in their current column; all others move to "In Progress".
- **Column movement on completion:** `plan` moves to "Todo", `implement`/`revise` move to "Review", `research` stays put.

Add your action to the appropriate conditional blocks in `dispatchTask()` and `onComplete()`:

```ts
// dispatchTask() — skip "In Progress" for lightweight actions
if (task.action !== 'plan' && task.action !== 'research' && task.action !== 'my-new-action') {
  // move to In Progress
}

// onComplete() — determine target column
if (task.action === 'my-new-action') {
  targetColumnName = 'Todo'
}
```

#### Step 3 --- Handle in prompt template

The action is available in your WORKFLOW.md Mustache template as `{{ issue.action }}`. Add conditional sections:

```mustache
{{#issue.action}}
{{#is_my_new_action}}
Special instructions for my-new-action...
{{/is_my_new_action}}
{{/issue.action}}
```

#### Step 4 --- Add precondition checks (if needed)

Some actions require `target_repo` to be set. Add validation in the `dispatchAgent` resolver:

```ts
if (action === 'my-new-action') {
  if (!existingTask.target_repo) {
    throw new Error(`Action '${action}' requires target_repo to be set.`)
  }
}
```

---

### 6. Add a web component

**Touch:** `packages/web/src/components/`

The frontend uses React 19, TanStack Router, Zustand, Tailwind CSS 4, tailwind-variants (`tv()`), and Radix UI primitives.

#### Pattern --- Feature component

Feature components live in `packages/web/src/components/feature/{domain}/`:

```
components/feature/task/
  TaskCard.tsx
  TaskDrawer.tsx
  ...
```

#### Pattern --- Common component

Shared primitives live in `packages/web/src/components/common/{name}/`:

```
components/common/button/
  Button.tsx
  index.ts        # re-export
```

#### Pattern --- GraphQL integration

1. Add query/mutation in `packages/web/src/graphql/queries.ts` or `mutations.ts`.
2. Call via the `graphql-request` client:

```ts
import { graphqlClient } from '../graphql/client'

const data = await graphqlClient.request(MY_QUERY, { id })
```

3. For subscriptions, use `graphql-sse` (see `packages/web/src/graphql/subscriptions.ts`).

#### Pattern --- State management

Board state is managed via Zustand in `packages/web/src/store/boardStore.ts`. Follow the existing store pattern to add new slices.

#### Pattern --- Styling

Use `tailwind-variants` (`tv()`) with data attributes instead of className ternaries:

```tsx
const card = tv({
  base: 'rounded-lg p-4',
  variants: {
    status: {
      active: 'border-blue-500',
      archived: 'opacity-50',
    },
  },
})
```

---

### 7. Swap agent runtime

The agent runtime is isolated in `packages/api/src/agent/runner.ts`.

#### Step 1 --- Replace CLI args builder

`buildClaudeArgs()` constructs the command. Replace or modify it for a different CLI tool:

```ts
function buildClaudeArgs(config: Config, prompt: string): string[] {
  const args: string[] = [
    config.claude.command,         // e.g. 'claude' or 'my-agent'
    '--print',
    '--output-format', 'json',
  ]
  if (config.claude.model) args.push('--model', config.claude.model)
  args.push('--max-turns', String(config.claude.max_turns))
  if (config.claude.allowed_tools?.length) {
    args.push('--allowedTools', config.claude.allowed_tools.join(','))
  }
  if (config.claude.permission_mode) {
    args.push('--permission-mode', config.claude.permission_mode)
  }
  args.push(prompt)
  return args
}
```

#### Step 2 --- Update config schema (if needed)

Modify `ClaudeSchema` in `packages/api/src/config/schema.ts`:

```ts
export const ClaudeSchema = z.object({
  command: z.string().default('claude'),
  model: z.string().optional(),
  max_turns: z.number().int().positive().default(50),
  allowed_tools: z.array(z.string()).optional(),
  permission_mode: z.string().optional(),
})
```

#### Step 3 --- Update stdout parsing

The runner expects exit code 0 = success, non-zero = failure. The full stdout is captured as `output`. If the new tool produces structured output, update the parsing in `runAgent()`.

#### Step 4 --- Environment variables

The runner injects these env vars into the spawned process:

- `HIVEBOARD_TASK_ID` --- task ULID
- `HIVEBOARD_TASK_TITLE` --- task title
- `HIVEBOARD_WORKSPACE` --- absolute workspace path

---

## Database Notes

### SQLite WAL mode

The database connection in `packages/api/src/db/client.ts` enables WAL mode and foreign keys on startup:

```ts
export const db = new Database(dbPath)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')
```

The database file path defaults to `tmp/database/hiveboard.db` (relative to project root) and can be overridden with the `DATABASE_PATH` env var.

### Migration approach

HiveBoard uses an **idempotent additive migration** strategy rather than numbered migration files:

1. `createTables(db)` --- runs `CREATE TABLE IF NOT EXISTS` for all tables and indexes.
2. `seed(db)` --- creates the default `queen-bee` user and `HiveBoard` board with five columns (Backlog, Todo, In Progress, Review, Done). Skips if the user already exists.
3. `addMissingColumns(db)` --- uses `ensureColumn()` to add columns that were introduced after initial schema, and `renameColumn()` to handle column renames. Both check `PRAGMA table_info` before acting.

All three run on every server start (in `packages/api/src/index.ts`).

### ULID generation

All primary keys are ULIDs generated by the `ulid` npm package (`packages/api/src/db/ulid.ts`):

```ts
import { ulid } from 'ulid'
export const generateId = (): string => ulid()
```

ULIDs are lexicographically sortable by creation time, which means `ORDER BY id ASC` is chronological.

### Seeded data

The seed creates:
- **User:** `queen-bee` / "Queen Bee" (role: admin)
- **Board:** "HiveBoard"
- **Columns:** Backlog (0), Todo (1), In Progress (2), Review (3), Done (4)

### Task positions

Tasks use `REAL` positions with a gap of 1024 between items. When a drag-and-drop causes gaps smaller than 1.0, the `moveTask` resolver re-indexes all tasks in the column with `(i + 1) * 1024` spacing.

---

## Testing

### Conventions

- Test runner: `bun:test` (built into Bun)
- Test files: `*.test.ts` in a `test/` directory
- Use `ConfigSchema.safeParse()` in tests (never `.parse()` which throws)
- For env-var-dependent tests, set vars in the test body and clean up with `delete process.env.VAR`
- Workspace tests create temp directories with `mkdtemp()` and clean up with `rm()`

### Running tests

```bash
# Run all tests
bun test

# Run a specific test file
bun test packages/api/test/config.test.ts
```

---

## CI Scripts

All scripts are defined in the root `package.json`:

| Script | Command | What it does |
|---|---|---|
| `dev` | `bun run --filter '*' dev` | Start both API and web in watch mode |
| `dev:api` | `bun run --filter api dev` | Start API only (with `--watch` and `.env`) |
| `dev:web` | `bun run --filter web dev` | Start Vite dev server |
| `build:web` | `bun run --filter web build` | Production build of the web frontend |
| `tsc` | `bunx tsc --noEmit` | Type-check the entire monorepo |
| `test` | `bun test` | Run all `bun:test` test suites |
| `fmt` | `bunx biome check --fix .` | Auto-format and auto-fix with Biome |
| `lint` | `bunx biome lint .` | Lint-only check with Biome |

### CI order

A typical CI run:

```bash
bun install
bun run lint        # Biome lint
bun run tsc         # TypeScript type check
bun test            # Unit tests
```

---

## Graceful Shutdown

The server registers handlers for both `SIGTERM` and `SIGINT` in `packages/api/src/index.ts`:

```ts
process.on('SIGTERM', async () => {
  const orchestrator = getOrchestrator()
  if (orchestrator) await orchestrator.shutdown()
  process.exit(0)
})
```

The orchestrator shutdown sequence (`packages/api/src/orchestrator/orchestrator.ts`):

1. Sets `shutdownRequested = true` to prevent new polls.
2. Clears the poll timer, sweep timer, and all retry timers.
3. Sends `abort()` to every running agent's `AbortController`.
4. Waits up to **30 seconds** for all agents to finish (polling every 500ms).
5. Logs a warning if any agents are still running after the timeout.
6. Logs "Orchestrator shut down" and returns.

The API itself (`Bun.serve`) does not need explicit shutdown --- `process.exit(0)` terminates it.

---

## Cross-References

- **Architecture overview:** [architecture.md](./architecture.md)
- **Coding conventions:** [conventions.md](./conventions.md)
- **Workflow configuration:** `WORKFLOW.md` (YAML front matter + Mustache prompt template)
- **Environment variables:** `.env` file (loaded automatically by Bun; `DATABASE_PATH`, `API_PORT`, `GITHUB_TOKEN`)
