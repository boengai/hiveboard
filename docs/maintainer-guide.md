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
| `orchestrator/` | `orchestrator.ts`, `singleton.ts`, `verify.ts`, `subtasks.ts`, `dependencies.ts`, `snapshot-loop.ts` | Poll loop, dispatch, concurrency, retry backoff, graceful shutdown, self-verify gate, subtask materialization, dependency cascade, 15s diff snapshotter |
| `agent/` | `runner.ts`, `prompt.ts`, `capability.ts`, `env.ts`, `summarize.ts`, `checkpoint-replay.ts`, `ndjson-line-parser.ts`, `prompt-partials/` | Spawns Claude CLI, builds args (stream-json vs json), renders Mustache prompt, parses NDJSON turn events, summarizes checkpoints, stream-json capability probe, shared prompt partials |
| `workspace/` | `manager.ts`, `path-safety.ts`, `agent-state.ts`, `progress-watcher.ts`, `cleanup.ts` | Per-task workspaces; per-task agent-state dir (scratchpad / inbox / question / progress / subtasks); TTL sweep; symlink-escape detection; tail-follow progress NDJSON |
| `secrets/` | `encryption.ts`, `enabled.ts`, `scrubber.ts`, `store.ts` | AES-256-GCM + HKDF-SHA256 envelope, `HIVEBOARD_SECRETS_KEY` boot probe, literal-match output scrubber, board/task secret CRUD + resolver |
| `playbooks/` | `index.ts` | Playbook + immutable `playbook_versions` CRUD, `getPlaybookByName`, tool-allowlist override resolution |
| `github/` | `client.ts` | GitHub client: App identity via `fetch` with JWT, PRs via `gh pr create`, review comments via `gh api` |
| `tunnel/` | *(empty --- reserved)* | Reserved for future Cloudflare tunnel integration |
| `pubsub.ts` | *(root file)* | Typed `graphql-yoga` PubSub instance. Channels: `TASK_UPDATED`, `AGENT_LOG`, `COMMENT_ADDED`, `TASK_EVENT`, `MESSAGE_ADDED`, `TASK_PROGRESS`, `WORKSPACE_SNAPSHOT`, `CHECKPOINT_ADDED`, `VERIFICATION_RUN`, `TASK_MISSING_SECRETS_CHANGED`, `SCRATCHPAD_UPDATED` |

The frontend lives under `packages/web/src/`:

| Directory | Purpose |
|---|---|
| `components/common/` | Reusable UI primitives (Badge, Button, Drawer, Icon, Input, Markdown) |
| `components/feature/` | Domain components (agent, board, task) |
| `graphql/` | `graphql-request` client, query/mutation/subscription definitions |
| `store/` | Zustand stores (`boardStore.ts`) |
| `pages/` | Page-level components (includes `/playbooks`) |
| `routes/` | TanStack Router route definitions |
| `types/` | Shared TypeScript types |
| `utils/` | Helper functions |

---

## How-To Recipes

### 1. Add a DB column

**Touch:** `schema.ts` -> `typeDefs.ts` -> `resolvers.ts`

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

#### Step 2 --- Add idempotent migration

Migrations live in the same file, below `createTables()`. Use `addColumnIfMissing()` so existing databases get the column. It checks `PRAGMA table_info` before altering.

```ts
// packages/api/src/db/schema.ts
addColumnIfMissing(db, 'tasks', 'priority', "TEXT DEFAULT 'medium'")
```

If the new column needs a one-time data fix, emit a narrow `UPDATE` that only touches rows without the new state. The Spec B `block_reason` backfill is the canonical example:

```sql
UPDATE tasks SET block_reason = 'QUESTION'
 WHERE agent_status = 'blocked' AND block_reason IS NULL;
```

Backfills run on every startup --- keep them idempotent.

#### Step 3 --- Expose in GraphQL schema

Add the field to the relevant type in `packages/api/src/schema/typeDefs.ts`:

```graphql
type Task {
  ...
  priority: String
}
```

If the column is writable, add it to the input types too.

#### Step 4 --- Update resolvers

1. Add the field to the `TaskRow` type alias in `resolvers.ts`.
2. Add the camelCase mapping in `mapTask()`.
3. If writable, update `createTask` / `updateTask` to include the column in their SQL statements.

---

### 2. Add a GraphQL mutation

**Touch:** `typeDefs.ts` -> `resolvers.ts` -> `pubsub.ts` (if real-time needed)

Follow the existing pattern: resolve current user, validate inputs, run SQL inside `db.transaction()`, insert a `task_events` row, publish to pubsub.

```ts
Mutation: {
  assignTask(_: unknown, { id, userId }: { id: string; userId: string }) {
    const user = getCurrentUser()
    const existing = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | null
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
    publishTaskUpdated(task)
    return task
  },
}
```

If the mutation must also trigger an orchestrator side effect (abort, requeue, unblock), call into the orchestrator singleton after the DB write: see `sendRedirect` -> `dispatchHumanMessage` for the pattern.

---

### 3. Add a subscription

**Touch:** `typeDefs.ts` -> `resolvers.ts` -> `pubsub.ts`

1. Add a channel to the `pubsub` type parameter in `packages/api/src/pubsub.ts`.
2. Add the publish helper (`publishXxx(...)`) in the same file.
3. Declare the `Subscription` field in `typeDefs.ts`.
4. Implement the `subscribe` + `resolve` pair in `resolvers.ts`.

The first argument to `pubsub.subscribe()` is the channel name; the second is the topic key (scopes which clients receive events). Publish from any mutation or orchestrator path using `publishXxx(scopeId, payload)`.

---

### 4. Add a config field

**Touch:** `config/schema.ts` -> `WORKFLOW.md`

Config is defined as Zod schemas in `packages/api/src/config/schema.ts` and parsed from the YAML front matter in `WORKFLOW.md`. Each top-level section uses `objectWithDefaults()` so it defaults gracefully when omitted.

Current top-level keys: `agent`, `claude`, `hooks`, `polling`, `progress`, `scheduler`, `verify`, `workspace`.

For secrets that come from env vars, use the `_envString()` helper (`resolves $MY_API_KEY` from `process.env`). Paths are resolved via `z.string().transform(path.resolve)` --- see `workspace.root` or `agent.state_root`.

---

### 5. Add an agent action

**Touch:** `resolvers.ts` (validation) -> `orchestrator.ts` (dispatch / completion) -> `WORKFLOW.md` (prompt template)

Built-in actions: `plan`, `implement`, `revise`. The allowlist lives in the `runAgent` resolver. Playbook dispatches use the reserved prefix `playbook:<name>` --- see "Playbooks" below.

Per-action column movement in `orchestrator.ts`:
- **On dispatch:** `plan` stays in its column; all others move to "In Progress".
- **On completion (success):** `plan` -> "Todo", `implement`/`revise` -> "Review", others stay.

The `BoardAction` GraphQL enum was removed in Spec F (`e246407`) and replaced with `String` so `"playbook:<name>"` values validate. Existing external consumers need to switch to the string form.

---

### 6. Add a web component

**Touch:** `packages/web/src/components/`

Stack: React 19, TanStack Router, Zustand, Tailwind CSS 4, tailwind-variants (`tv()`), Radix UI primitives, `graphql-request` (queries/mutations), `graphql-sse` (subscriptions).

- Feature components under `components/feature/{domain}/`.
- Shared primitives under `components/common/{name}/` with an `index.ts` re-export.
- GraphQL: add in `packages/web/src/graphql/queries.ts` / `mutations.ts` / `subscriptions.ts`.
- State: extend `boardStore.ts` or add a new slice under `store/`.
- Styling: use `tv()` with data attributes instead of className ternaries.

Note: `TaskTimeline.tsx` was renamed `TaskEventHistory.tsx` (Spec D) to free the original name for the new diff scrubber component. If you have in-flight branches referencing `TaskTimeline`, rebase before wiring.

---

### 7. Swap agent runtime

The agent runtime is isolated in `packages/api/src/agent/runner.ts`. `buildClaudeArgs()` constructs the command line; `runAgent()` spawns via `Bun.spawn`, streams stdout to `onLog`, parses NDJSON turns (if stream-json is supported), and returns `{ success, output, error }`.

For a drop-in swap:

1. Replace `buildClaudeArgs()` to build your target CLI's args. If the new CLI doesn't emit NDJSON, you can pass through `buildAgentEnv()` + `Bun.spawn` unchanged --- checkpoint capture will no-op via the capability gate.
2. Modify `ClaudeSchema` in `config/schema.ts` if new flags are needed.
3. The runner expects exit code 0 = success. Full stdout is returned as `output`.
4. Env vars injected into the spawned process (from `agent/env.ts`): `HIVEBOARD_TASK_ID`, `HIVEBOARD_TASK_TITLE`, `HIVEBOARD_WORKSPACE`, `HIVEBOARD_SCRATCHPAD`, `HIVEBOARD_INBOX`, `HIVEBOARD_QUESTION`, `HIVEBOARD_PROGRESS`, `HIVEBOARD_SUBTASKS`. Decrypted per-task secrets are merged on top under their declared names (not under `HIVEBOARD_*`).

---

## Config Reference (WORKFLOW.md front matter)

All keys below live in the YAML front matter at the top of `WORKFLOW.md` and are parsed in `packages/api/src/config/schema.ts`. Every section is optional --- defaults apply when omitted.

### `agent.*` (Spec A)

```yaml
agent:
  max_concurrent_agents: 5
  max_retry_backoff_ms: 300000
  state_root: ./tmp/agent-state   # NEW — Spec A
```

`state_root` is the per-task scratchpad/inbox/question/progress/subtasks parent dir. Each task gets a subdirectory `{state_root}/{task_id}/`. **Disk budget** --- scratchpads are capped at 64 KB (tail-truncated with a marker); progress NDJSON is append-only and grows with turn count; question files capped at 32 KB. Workspace snapshots live in SQLite (see `progress.*` below), not this dir.

### `verify.*` (Spec C)

```yaml
verify:
  enabled: true
  max_auto_revises: 1
  commands:
    - { label: lint,  run: "bun run lint",  timeout_ms: 300000 }
    - { label: tsc,   run: "bun run tsc",   timeout_ms: 300000 }
    - { label: tests, run: "bun test",      timeout_ms: 300000 }
```

Runs AFTER a successful `implement`/`revise` and BEFORE PR creation. On red, queues an auto-REVISE and pastes the failure output into the next prompt. `max_auto_revises=1` means one auto-retry; if that fails, the task transitions to `FAILED` with `agent_error="verification failed after N attempt(s)"`. Per-task override via `setTaskVerifyCommands` mutation (recorded as `tasks.verify_commands`, a JSON array).

### `progress.*` (Spec D)

```yaml
progress:
  enabled: true
  snapshot_interval_ms: 15000
  snapshot_disk_budget_mb: 10
```

Two surfaces: (a) agent writes NDJSON to `$HIVEBOARD_PROGRESS` --- tail-followed by `progress-watcher.ts` and published over `TASK_PROGRESS`; (b) orchestrator runs `git diff` every `snapshot_interval_ms` during RUNNING, stored in `workspace_snapshots`. The snapshot loop is torn down **before** verify runs to avoid racing on the workspace. Disk budget is advisory --- overly large patches are truncated.

### `scheduler.*` (Spec E)

```yaml
scheduler:
  legacy_mode: false
```

When `true`, scheduler falls back to the pre-Spec-E `SELECT` that ignores `task_dependencies`. Escape hatch for prod if the dep-aware SELECT misbehaves. Task time boxes, subtask materialization, and the dependency cascade are NOT gated by this flag --- only the scheduler itself.

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
2. `addColumnIfMissing(...)` --- add columns that post-date initial schema. Checks `PRAGMA table_info` first.
3. `seed(db)` --- creates the default `queen-bee` user, HiveBoard board, seeded playbooks (`bump-dep`, `add-tests`, `triage-flake`, `security-review`). Skips if already present.
4. Narrow UPDATE backfills at the bottom of `createTables()` for one-time data fixes.

All run on every server start (from `packages/api/src/index.ts`).

### Schema changes introduced by Specs A-H

**New tables:**

| Table | Spec | Purpose |
|---|---|---|
| `task_messages` | B | Bidirectional agent/human messages (`hint`, `redirect`, `question`, `answer`). Indexed for undelivered-by-task fast path. |
| `verification_runs` | C | One row per verify command execution, with exit code + captured output. Joined to `agent_runs` for trace reconstruction. |
| `workspace_snapshots` | D | 15s `git diff` snapshots during RUNNING. Stores a stat hash + file-status JSON; full patch is `BLOB` (may be NULL when unchanged). |
| `task_dependencies` | E | `(task_id, blocker_id)` edge table, composite PK. Cycle detection enforced at mutation time. |
| `agent_run_checkpoints` | G | One compact row per Claude CLI turn, only when stream-json is supported. Disabled wholesale if capability probe fails. |
| `playbooks` | F | Immutable playbook identity (`name` UNIQUE) with pointer to current version. |
| `playbook_versions` | F | Every edit creates a new row; the `agent_runs.playbook_version_id` FK pins which version an agent actually ran. |
| `board_secrets` | H | Board-scoped secret defaults. Ciphertext only; `BLOB`. UNIQUE on `(board_id, name)`. |
| `task_secrets` | H | Task-scoped secret overrides. UNIQUE on `(task_id, name)`. |

**New columns on `tasks`:**

| Column | Spec | Notes |
|---|---|---|
| `verify_attempt_count` | C | INT, incremented per auto-REVISE. Resets on manual dispatch (see `sendRedirect`). |
| `verify_commands` | C | JSON array (nullable) overriding `verify.commands` for this task. |
| `pending_auto_revise_source_run_id` | C | Pointer to the agent_run whose verification failed. Cleared on the next spawn. |
| `parent_task_id` | E | Self-reference for agent-spawned subtasks. |
| `time_box_ms` | E | Per-task budget in ms; aborts the run on expiry. |
| `time_box_started_at` | E | Stamped when dispatch begins; used by UI for the countdown. |
| `block_reason` | E | `QUESTION` \| `TIMEOUT` \| `DEPENDENCY_FAILED`. Distinguishes why a BLOCKED task is blocked. |
| `required_secrets` | H | JSON array of `UPPER_SNAKE` secret names. Defaults to `'[]'`. |

**New column on `agent_runs`:**
- `playbook_version_id` (Spec F) --- NULL for built-in actions; immutable audit pointer for `playbook:<name>` runs.

**One-time backfill:** `tasks.block_reason = 'QUESTION'` for any row still `agent_status = 'blocked'` at startup with `block_reason IS NULL` (handles databases that had BLOCKED tasks from Spec B before Spec E added `block_reason`). Idempotent --- runs every boot, only touches rows that still need it.

### ULID generation

All primary keys are ULIDs (`packages/api/src/db/ulid.ts`). ULIDs are lexicographically sortable by creation time, so `ORDER BY id ASC` is chronological.

### Seeded data

- **User:** `queen-bee` / "Queen Bee" (role: admin)
- **Board:** "HiveBoard"
- **Columns:** Backlog (0), Todo (1), In Progress (2), Review (3), Done (4)
- **Playbooks (Spec F):** `bump-dep`, `add-tests`, `triage-flake`, `security-review`

### Task positions

Tasks use `REAL` positions with a gap of 1024 between items. When a drag-and-drop causes gaps smaller than 1.0, the `moveTask` resolver re-indexes all tasks in the column with `(i + 1) * 1024` spacing.

---

## Required Environment Variables

| Var | Required? | Purpose |
|---|---|---|
| `DATABASE_PATH` | optional | SQLite path override (default `tmp/database/hiveboard.db`). |
| `API_PORT` | optional | Default `8080`. |
| `WEB_PORT` | optional | Default `5173`. |
| `GITHUB_TOKEN` or App triple | required | PAT (`ghp_` / `github_pat_`) OR `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` + `GITHUB_APP_INSTALLATION_ID`. Bare `ghs_` installation tokens are rejected. |
| `CORS_ALLOWED_ORIGINS` | required in prod | Comma-separated; production startup fails fast if unset. |
| `SESSION_SECRET` | required for OAuth | Signs OAuth state cookies. |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | required for remote mode | Human invitation / login flow. |
| **`HIVEBOARD_SECRETS_KEY`** | **required for Spec H** | AES-256-GCM KEK. Generate with `openssl rand -base64 32`. If unset: `setBoardSecret`/`setTaskSecret` reject with `SECRETS_DISABLED`; any task with non-empty `required_secrets` transitions to `MISSING_SECRETS` at spawn time. Rotating the key renders existing ciphertext unreadable --- re-enter every secret. See `.env.example` for the full block. |

---

## Capability Gating (Spec G)

At boot, `packages/api/src/index.ts` awaits `detectCheckpointSupport()` before the orchestrator starts. The probe runs `<claude.command> --help` and greps for `stream-json`. Outcomes:

- **Supported:** `--output-format stream-json` + `--verbose` flags are used; each turn is inserted into `agent_run_checkpoints`; replay payloads are constructed on retry.
- **Unsupported:** falls back to `--output-format json`; checkpoint capture is **globally** disabled. On retry, no replay is injected --- equivalent to pre-Spec-G behavior.

**Diagnosis:**

```bash
claude --help | grep stream-json     # should print a line; silence => disabled
```

Test-only override: `_setCheckpointSupportForTest(true|false|undefined)`.

---

## Orchestrator Post-Exit Pipeline

The ordered chain inside `Orchestrator.onComplete()` is load-bearing. Maintainers editing this path **must preserve ordering**:

1. **Time-box expiry** (Spec E). If `runState.abortReason === 'TIMEOUT'`, transition to `BLOCKED` with `block_reason='TIMEOUT'` and return. Wins over the question flow because the agent was killed mid-thought and the question file is untrusted.
2. **Scratchpad write** is agent-authored during the run --- not a post-exit step. Mentioned here for ordering clarity: anything the agent wrote to `>>` `$HIVEBOARD_SCRATCHPAD` is already on disk when we enter `onComplete()`.
3. **Question detection** (Spec B). Reads `$HIVEBOARD_QUESTION`. If non-empty, transition to `BLOCKED` with `block_reason='QUESTION'`, insert a `task_messages` row of kind `question`, publish `MESSAGE_ADDED` + `TASK_UPDATED`, unlink the file, return. **Short-circuits everything after it.**
4. **Subtask manifest** (Spec E). Reads `$HIVEBOARD_SUBTASKS`. Creates up to 20 children. Invalid manifest -> rename to `.errored`; DB failure -> log + continue parent flow.
5. **Verification gate** (Spec C). For `implement`/`revise` only. On red, either dispatches auto-REVISE or transitions to `FAILED` once `max_auto_revises` is exhausted. Returns early on auto-REVISE.
6. **PR creation** --- parses PR URL from agent output, falls back to `gh api` by head branch, stamps `tasks.pr_url`.

The snapshot loop + progress watcher are torn down **before** step 5 to avoid racing with verify commands that shell out `bun run lint/tsc/test`.

---

## Output Scrubbing (Spec H)

`packages/api/src/secrets/scrubber.ts` does **literal-match** replacement. For each decrypted value, every occurrence in `agent_runs.output` / `agent_runs.error` is replaced with `[redacted:NAME]`. Single-pass, one compiled regex, longer values win ties. No entropy heuristics; no regex detection.

**Known limitation:** the live stream (`onLog` -> `AGENT_LOG` pubsub) is NOT scrubbed. Subscribers may briefly see plaintext in flight. The captured `agent_runs.output` on disk is scrubbed before return. **Mitigation:** the agent prompt's secrets block instructs the model not to echo values. Live-stream scrubbing is deferred (see Plan H "Out of Scope").

If you add a new sink for agent output, route the string through `scrubSecrets(output, buildScrubPairs(secretsEnv, secretValues))` first.

---

## Playbook Partials

Shared Mustache partials live in `packages/api/src/agent/prompt-partials/`:

- `scratchpad.mustache` (Spec A)
- `messages.mustache` (Spec B)
- `question.mustache` (Spec B)
- `progress.mustache` (Spec D)
- `subtasks.mustache` (Spec E)

`loadPromptPartials()` reads every `*.mustache` in this directory at first call and memoizes. **Both built-in action prompts (`WORKFLOW.md`) and playbook prompts are rendered through the same partial set** (Spec F). Editing any partial affects BOTH paths --- there is no action-specific bypass.

`agent_runs.playbook_version_id` is the immutable audit trail: when a playbook edit creates a new `playbook_versions` row, existing `agent_runs` keep pointing at the old version. Do not prune old versions (see Operational Runbooks below).

---

## Feature Flags and Escape Hatches

| Flag | Effect |
|---|---|
| `scheduler.legacy_mode: true` | Falls back to pre-Spec-E scheduler. Ignores `task_dependencies`. All other Spec-E features (time-box, subtasks, cascade) remain active. |
| `verify.enabled: false` | Skips the self-verify gate after IMPLEMENT/REVISE. PR creation proceeds immediately. |
| `progress.enabled: false` | Disables both the progress watcher and the 15s diff snapshotter. `workspace_snapshots` table stays empty. |
| `HIVEBOARD_SECRETS_KEY` unset | Entire Spec-H feature is inert. `required_secrets` declarations force `MISSING_SECRETS` at spawn time (effectively holds the task). |
| Claude CLI without stream-json | Spec G auto-disables; retries fall back to no-replay behavior. |

---

## Operational Runbooks

### "Task is stuck in MISSING_SECRETS"

1. Verify `HIVEBOARD_SECRETS_KEY` is set:
   ```bash
   printenv HIVEBOARD_SECRETS_KEY | head -c 8
   ```
   If empty, generate with `openssl rand -base64 32`, add to `.env`, restart.
2. List missing names via GraphQL:
   ```graphql
   query { task(id: "...") { missingSecrets requiredSecrets } }
   ```
3. Set them via the UI (Board Settings -> Secrets, or Task drawer -> Secrets override) which calls `setBoardSecret` / `setTaskSecret`. Setting a missing secret triggers auto-unblock with a 5-second grace window.
4. Direct DB insert is possible but requires re-encrypting with the live KEK --- the mutation path is strongly preferred. If you must, call `setBoardSecret(db, { boardId, name, value, userId, description })` from a repl; raw `INSERT INTO board_secrets` without the KEK will produce un-decryptable rows.

### "Agent timed out but didn't BLOCK"

Expected transition for a time-box expiry: `RUNNING` -> `BLOCKED` with `block_reason='TIMEOUT'`. If the task landed in `FAILED` instead:

1. Check `tasks.block_reason` --- should be `'TIMEOUT'`.
2. If NULL, the `AbortController` race lost: the abort landed after `runAgent` resolved naturally, so the non-timeout success/fail path ran. Inspect `agent_runs.finished_at` vs. the expected expiry time (`time_box_started_at + time_box_ms`).
3. Look for a `time_box_expired` row in `task_events`. If missing, the timer didn't fire --- likely `runState.timeBoxTimer` was cleared early by `stopObservability`.

### "Auto-REVISE loop exhausted"

`verify_attempt_count` is bumped per auto-dispatch and capped at `verify.max_auto_revises` (default 1). Once exhausted the task goes to `FAILED` with `agent_error="verification failed after N attempt(s)"`.

To retry manually:
1. `continueFailedTask(taskId)` --- increments `retry_count`, sets `agent_status='queued'`. Does NOT reset `verify_attempt_count`.
2. A **human `sendRedirect` or fresh `runAgent` dispatch resets `verify_attempt_count` to 0** (see `dispatchHumanMessage`). Use this if the fix requires a clean slate.

### "Playbook version history grew large"

`playbook_versions` is append-only. Every edit creates a new row; `agent_runs.playbook_version_id` holds immutable references to every version ever executed. **Not currently prunable** --- deleting versions breaks historical agent-run auditing. Acceptable for now: one row per edit, per playbook, is tractable for typical use. Future work: archival compaction keyed on "no live agent_runs reference this version and it's not `current_version_id`".

### "Checkpoint replay missing for a retry"

1. Confirm stream-json support: `claude --help | grep stream-json`. If silent, Spec G is globally off.
2. Confirm checkpoint rows exist for the prior run:
   ```sql
   SELECT COUNT(*) FROM agent_run_checkpoints
    WHERE agent_run_id = (
      SELECT id FROM agent_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 2 OFFSET 1
    );
   ```
3. `buildPreviousAttemptReplay()` skips runs where `retry_count == 0`. Manual retries via `continueFailedTask` increment `retry_count`, so replay fires. Fresh dispatches (new `runAgent`) do not.

---

## Testing

### Conventions

- Test runner: `bun:test` (built into Bun)
- Test files: `*.test.ts` under `packages/api/test/`
- Use `ConfigSchema.safeParse()` in tests (never `.parse()` which throws)
- For env-var-dependent tests, set vars in the test body and clean up with `delete process.env.VAR`
- Workspace tests create temp directories with `mkdtemp()` and clean up with `rm()`
- Secrets tests: call `_setKekForTest(buf)` / `_setSecretsEnabledForTest(true|false|undefined)` to seed state without touching env.
- Checkpoints tests: call `_setCheckpointSupportForTest(true|false|undefined)` to bypass the boot probe.

### macOS test suite

`packages/api/test/path-safety.test.ts` previously had five environment-dependent failures caused by the macOS `/var` -> `/private/var` symlink on `os.tmpdir()`. **Fixed in `3729abc`** --- tests now canonicalize paths before comparison. Expect a green run locally on macOS.

### Running tests

```bash
bun test                                       # all
bun test packages/api/test/config.test.ts      # single file
bun test packages/api/test/secrets             # directory
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

The orchestrator shutdown sequence:

1. Sets `shutdownRequested = true` to prevent new polls.
2. Clears the poll timer, sweep timer, and all retry timers.
3. Sends `abort()` to every running agent's `AbortController`. Per-run `timeBoxTimer`s are cleared via `stopObservability()` in the `finally` path.
4. Waits up to **30 seconds** for all agents to finish (polling every 500ms).
5. Logs a warning if any agents are still running after the timeout.
6. Logs "Orchestrator shut down" and returns.

The progress watcher + snapshot loop are torn down per-run as part of `stopObservability()` --- no separate shutdown hook is needed for them.

The API itself (`Bun.serve`) does not need explicit shutdown --- `process.exit(0)` terminates it.

---

## Cross-References

- **Architecture overview:** [architecture.md](./architecture.md)
- **Coding conventions:** [conventions.md](./conventions.md)
- **API reference:** [api-reference.md](./api-reference.md)
- **Workflow configuration:** `WORKFLOW.md` (YAML front matter + Mustache prompt template)
- **Environment variables:** `.env.example` (template) + `.env` (local, gitignored)
- **Changelog:** `CHANGELOG.md` (Unreleased section covers Specs A-H)
