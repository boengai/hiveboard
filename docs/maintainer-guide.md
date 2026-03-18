# Maintainer Guide

This guide is for developers who need to modify or extend HiveBoard.

## Architecture

```
Webhook (Bun.serve)  ──►  Orchestrator  ──►  Agent Runner (Claude CLI)
                              │                     │
Polling (setInterval) ──►     │               Prompt Renderer (Mustache)
                              ▼
                     GitHub Projects V2 Client
                        │           │
                  Label Parser    Review Comments
                        │
                  Workspace Manager ──► SSH Client (optional)
                        │
                  Tunnel Manager (cloudflared, optional)
```

The **Orchestrator** is the central coordinator. It receives issues from two sources (webhook and polling), manages an in-memory state map of running/completed/retrying agents, and dispatches work to the **Agent Runner**. The Agent Runner spawns a Claude CLI process per issue inside an isolated workspace.

For `action:revise` dispatches, the orchestrator fetches PR review comments linked to the issue and passes them to the prompt renderer so the agent has context on what to fix.

## Module responsibilities

| Module | File(s) | What it owns |
|---|---|---|
| Config | `src/config/schema.ts`, `loader.ts` | Zod schemas, WORKFLOW.md parsing, env var resolution |
| GitHub Client | `src/github/client.ts`, `queries.ts`, `types.ts` | All GitHub GraphQL API calls (projects V2, labels, columns, review comments), owner-type detection (repo/org/user), project metadata caching |
| Labels | `src/labels/parse-repo.ts` | Parsing `repo:*` labels into `{ repoOwner, repoName }` with `owner/name` or bare-name formats |
| Orchestrator | `src/orchestrator/orchestrator.ts`, `state.ts` | Poll loop, dispatch decisions, concurrency limits, retry scheduling, worker host selection, graceful shutdown |
| Workspace | `src/workspace/manager.ts`, `path-safety.ts` | Per-issue directory creation/removal, lifecycle hooks, symlink escape detection |
| Agent | `src/agent/runner.ts`, `prompt.ts` | Claude CLI process spawning, Mustache prompt rendering, review comment formatting, continuation prompts, abort handling |
| Webhook | `src/webhook/server.ts`, `handlers.ts` | HTTP server, GitHub signature verification, event routing |
| SSH | `src/ssh/client.ts` | Remote command execution via `ssh` binary |
| Tunnel | `src/tunnel/cloudflare.ts` | Cloudflare tunnel lifecycle (quick tunnels via `trycloudflare.com`, named tunnels via token) |
| Types | `src/types/issue.ts` | Shared interfaces (`Issue`, `RunState`, `RetryEntry`, `AgentResult`) |

## How-to recipes

### Adding a new config field

1. Add the Zod field to the appropriate schema in `src/config/schema.ts`
2. If it's a secret, use `envStringRequired()` or `envString()` and add a `$VAR_NAME` reference
3. Update `.env.example` with the new variable
4. Update the config table in `README.md`
5. Add a test case in `test/config.test.ts`

### Adding a new action label

Action labels (e.g. `action:plan`, `action:implement`) are just strings — no code change needed. The orchestrator dispatches any issue that has a label matching the `action_prefix`. The prompt template receives the action via `{{ issue.action }}`, so add conditional logic in the `WORKFLOW.md` prompt body:

```
{{#issue.action}}
Action: {{ issue.action }}
{{/issue.action}}
```

### Adding a new webhook event

1. Add the payload interface in `src/webhook/handlers.ts`
2. Write the handler function
3. Add a `case` branch in `handleWebhookRequest()` in `src/webhook/server.ts`
4. Add a test

### Changing the agent runtime

The agent runtime is isolated in `src/agent/runner.ts`. To swap Claude CLI for another tool:

1. Update `buildClaudeArgs()` (or replace it) to construct the new CLI command
2. Update `ClaudeSchema` in `src/config/schema.ts` if config shape changes — current fields include `command`, `model`, `max_turns`, `allowed_tools` (optional tool whitelist), and `permission_mode`
3. The runner expects a process that exits 0 on success and non-zero on failure
4. If the new tool doesn't support `--print --output-format json`, update the stdout parsing logic
5. Update `runContinuation()` if the new tool handles retries differently

### Adding a new tracker (non-GitHub)

The GitHub client is used directly by the orchestrator. To support another tracker:

1. Extract an interface from `GitHubClient` (e.g. `TrackerClient`)
2. Implement the interface for the new tracker
3. Select the implementation based on `tracker.kind` in the config schema
4. Update `TrackerSchema` to accept the new `kind` value as a discriminated union

### Working with review comments (revise flow)

When `action:revise` is dispatched, the orchestrator calls `GitHubClient.fetchReviewComments()` which:

1. Looks up cross-referenced PRs from the issue timeline
2. Prefers the most recent open PR, falling back to merged or last linked
3. Extracts comments from `CHANGES_REQUESTED` and `COMMENTED` reviews
4. Returns `FormattedReviewComment[]` with author, body, file path, line, and diff hunk

These are passed to `renderPrompt()` which makes them available in the Mustache template via `{{ review_comments }}` and `{{ has_review_comments }}`.

### Working with the tunnel module

`src/tunnel/cloudflare.ts` manages the `cloudflared` process lifecycle:

- **Quick tunnel** (no token): spawns `cloudflared tunnel --url http://localhost:<port>` and parses the random `*.trycloudflare.com` URL from stderr
- **Named tunnel** (token provided): spawns `cloudflared tunnel run --token <token>` and resolves when "Registered tunnel connection" appears in logs

The `startTunnel()` function returns a `TunnelResult` with the child process and a `Promise<string>` that resolves with the public URL. Call `stopTunnel()` on shutdown.

### Working with hooks

Hooks are optional shell commands run at workspace lifecycle stages. They're defined in WORKFLOW.md under the `hooks` key:

- `after_create` — runs after the workspace directory is created (commonly used for `git clone` + branch setup)
- `before_run` — runs before the agent starts
- `after_run` — runs after the agent finishes
- `before_remove` — runs before workspace cleanup

Hook commands are Mustache-rendered with issue context (e.g. `{{ issue.number }}`, `{{ issue.repo_owner }}`). They run inside the workspace directory with a configurable `timeout_ms` (default 60s).

## Key design details

### Environment variable resolution

Any string config field using `envStringRequired()` or `envString()` in the schema will resolve `$VAR_NAME` values from `process.env` at parse time. This happens during Zod validation — if the variable is missing, `safeParse` returns a validation error. There is also `envIntRequired()` for numeric fields like `project_number` that resolve env vars and coerce to positive integers. Bun auto-loads `.env` before the config is parsed.

### Retry and backoff

Failed agents are retried with exponential backoff: `10s * 2^(attempt-1)`, capped at `agent.max_retry_backoff_ms` (default 5 minutes). The retry flow:

1. Agent fails → `status:failed` label added, `status:running` removed
2. Timer fires after backoff delay → `status:failed` removed, original `action:*` label re-added
3. Next poll picks up the issue as a new dispatch candidate

The `RetryEntry` tracks the attempt count, due time, error message, and the worker host/workspace path of the failed run.

Retry state is in-memory. If HiveBoard restarts, polling will rediscover issues that still have action labels.

There is also a `runContinuation()` function that re-runs an agent with a continuation prompt instead of the full template, so the agent can resume from the existing workspace state rather than starting from scratch.

### Graceful shutdown

On `SIGTERM`/`SIGINT`:

1. Poll timer and retry timers are cancelled
2. All running agents receive an abort signal
3. HiveBoard waits up to 30s for agents to exit
4. Process exits

### Label auto-creation

When HiveBoard needs to add a label that doesn't exist on the repository, the GitHub client automatically creates it via the REST API. Labels are color-coded by prefix: `action:*` labels get one color, `status:*` another, and `repo:*` another. Columns on the Projects V2 board cannot be auto-created — they must exist before HiveBoard runs.

### Label and column state model

Labels and columns serve different purposes:

- **Labels** drive automation: `action:*` triggers dispatch, `repo:*` routes to a repository, `status:*` tracks runtime state
- **Columns** drive visual status on the project board: "In Progress", "Review", "Done"

HiveBoard manages both — it swaps labels and moves columns as agents progress through their lifecycle.

### Owner-type detection

The GitHub client supports three project scopes:

- **Repo-scoped** (`tracker.repo` is set) — uses `repository.projectV2` queries
- **Org-scoped** (owner is a GitHub Organization) — uses `organization.projectV2` queries
- **User-scoped** (owner is a GitHub User) — uses `user.projectV2` queries

Owner type is auto-detected on first API call via the `OWNER_TYPE_QUERY` and cached for the session. For org/user-scoped projects, each issue must have a `repo:*` label so HiveBoard knows which repository to resolve labels from.

### Repo label parsing

The `parseRepoLabel()` function in `src/labels/parse-repo.ts` supports two formats:

- `repo:frontend` — uses the tracker owner as the repo owner
- `repo:other-org/backend` — explicit owner/name pair

### Worker host selection

When SSH hosts are configured (`worker.ssh_hosts`), the orchestrator selects the least-loaded host that is under its `max_concurrent_agents_per_host` limit. If no host has capacity, the issue waits for the next poll cycle.

### Agent environment variables

Locally-spawned agents receive these environment variables:

- `HIVEBOARD_ISSUE_ID` — the GitHub node ID
- `HIVEBOARD_ISSUE_NUMBER` — the issue number
- `HIVEBOARD_WORKSPACE` — absolute path to the workspace directory

### Completion flow

On success:
1. `status:running` removed, `action:review` added
2. Issue moved to the Review column

On failure:
1. `status:running` removed, `status:failed` added
2. Retry scheduled with exponential backoff

## Testing conventions

- Tests use `bun:test` (not vitest or jest)
- Test files live in `test/` and are named `*.test.ts`
- Use `ConfigSchema.safeParse()` for schema tests (never call `.parse()` in tests — it throws)
- For tests that need env vars, set them in the test body and clean up with `delete process.env.VAR`
- Workspace tests create temp directories with `mkdtemp()` and clean up with `rm()`

## CI pipeline

`make ci` runs in this order:

1. `bun install` — install dependencies
2. Biome check — formatting and lint
3. TypeScript — type check (`tsc --noEmit`)
4. `bun test` — run all tests

All four must pass for CI to be green. The GitHub Actions workflows:

- `.github/workflows/make-all.yml` — runs `make ci` on every push and PR
- `.github/workflows/pr-description-lint.yml` — lints PR descriptions
