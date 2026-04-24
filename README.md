# HiveBoard

HiveBoard is a local-first Kanban board for AI agent orchestration. You create tasks on the board UI, and HiveBoard dispatches autonomous coding agents (Claude CLI) to complete them. GitHub is the code host — agents open PRs there — but the board, task state, and orchestration are fully self-contained.

Inspired by [OpenAI Symphony](https://github.com/openai/symphony) and [Stripe Minions](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents).

> [!WARNING]
> HiveBoard is an engineering preview for testing in trusted environments.

## Feature highlights

- **Persistent agent memory** — each task has a scratchpad that survives across PLAN → IMPLEMENT → REVISE runs.
- **Two-way agent ↔ human channel** — agents can pause with a question; humans can send hints, redirects, or answers mid-run.
- **Auto-verify before PR** — failing lint / typecheck / tests trigger an auto-REVISE instead of shipping a broken PR.
- **Progress visibility** — structured step pings plus a scrubbable diff timeline of the workspace.
- **Task graphs** — per-task dependencies, agent-spawned subtasks, and per-task time-boxes.
- **Playbooks** — named, versioned prompt recipes beyond the built-in PLAN/IMPLEMENT/REVISE actions.
- **Turn-by-turn retry replay** — a failed run's trace is distilled and injected into the next run's prompt, so retries don't start from zero.
- **Encrypted per-task secrets** — declare required env vars per task; values are encrypted at rest, scrubbed from captured output, and only decrypted at spawn time.

See [CHANGELOG.md](CHANGELOG.md) for the release-by-release breakdown.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Browser (localhost:5173)                            │
│  React + Vite + Tailwind + Zustand                   │
│  Board View │ Task Drawer │ Real-time Subscriptions  │
│             │ GraphQL + SSE (subscriptions)          │
└─────────────┼────────────────────────────────────────┘
              │
┌─────────────▼────────────────────────────────────────┐
│  API Server (localhost:8080)                         │
│  Bun + GraphQL Yoga                                  │
│  Resolvers │ Orchestrator │ GitHub Client │ Secrets  │
│                │                                     │
│  ┌─────────────▼──────────────┐                      │
│  │  Bun SQLite (local)        │                      │
│  │  tmp/database/hiveboard.db │                      │
│  └────────────────────────────┘                      │
└──────────────────────────────────────────────────────┘
```

**Monorepo layout (Bun workspaces):**

```
hiveboard/
├── package.json              # root — workspaces: ["packages/*"]
├── packages/
│   ├── api/                  # GraphQL Yoga API server + orchestrator + SQLite
│   │   └── WORKFLOW.md       # Agent prompt template + runtime config
│   └── web/                  # React 19 + Vite + TanStack Router frontend
├── tmp/
│   ├── database/             # SQLite database (git-ignored)
│   ├── workspaces/           # Per-task agent workspaces (git-ignored)
│   └── agent-state/          # Per-task scratchpad, inbox, question,
│                             # progress, subtask manifests (git-ignored)
└── docs/
    ├── architecture.md       # Design rationale and internals
    ├── api-reference.md      # GraphQL surface reference
    ├── maintainer-guide.md   # Operational runbook + internals
    └── conventions.md        # Coding conventions
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.1+
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- A GitHub personal access token with `repo` scope, or a GitHub App (for PR creation)

### Install and run

```bash
git clone https://github.com/boengai/hiveboard.git
cd hiveboard
bun install
cp .env.example .env   # then edit .env with your auth config
bun run dev            # starts API (localhost:8080) + web (localhost:5173)
```

Open [http://localhost:5173](http://localhost:5173) to see the board.

## Environment Setup

Copy `.env.example` to `.env` and set your values:

```bash
# ── GitHub Auth (required — choose one) ───────────────
# Option A: Personal access token (ghp_ or github_pat_ prefix)
GITHUB_TOKEN=ghp_your_token_here

# Option B: GitHub App (set these INSTEAD of GITHUB_TOKEN)
# GITHUB_APP_ID=123456
# GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
# GITHUB_APP_INSTALLATION_ID=12345678

# NOTE: Bare installation tokens (ghs_) are not supported.

# ── GitHub OAuth (required for remote/internet access) ─
# GITHUB_OAUTH_CLIENT_ID=your_oauth_app_client_id
# GITHUB_OAUTH_CLIENT_SECRET=your_oauth_app_client_secret
# SESSION_SECRET=replace-with-32-random-bytes   # required when OAuth is enabled

# ── CORS (required in production) ─────────────────────
# Comma-separated list of allowed origins for credentialed requests.
# Dev default: http://localhost:$WEB_PORT + http://localhost:$API_PORT.
# In production (NODE_ENV=production) the API refuses to start unless set.
# CORS_ALLOWED_ORIGINS=https://hiveboard.example.com

# ── Per-task secrets (required if any task declares required_secrets) ─
# 32-byte key, base64-encoded. Generate with: openssl rand -base64 32
# When absent, the secrets feature is disabled; tasks with declared
# required_secrets are held in MISSING_SECRETS until the key is set.
# HIVEBOARD_SECRETS_KEY=base64-encoded-32-bytes

# ── Optional ──────────────────────────────────────────
# API_PORT=8080
# WEB_PORT=5173
# CLAUDE_CODE_VERSION=latest   # Pin Claude Code version in Docker builds
```

## Available Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start both API and web in watch mode |
| `bun run dev:api` | Start API server only |
| `bun run dev:web` | Start Vite dev server only |
| `bun run start` | Build and start production server |
| `bun run build:api` | Build API server for production |
| `bun run build:web` | Build frontend for production |
| `bun run tsc` | Type-check all packages |
| `bun run test` | Run tests |
| `bun run fmt` | Auto-fix formatting and lint (Biome) |
| `bun run lint` | Lint only |
| `bun run check` | Run lint + fmt + test + tsc + build |

## Docker

### Pull from GHCR

```bash
docker pull ghcr.io/boengai/hiveboard:latest
```

**Available tags:** `:X.Y.Z` (exact version), `:X.Y` (latest patch), `:latest` (newest stable release)

### Run with Docker Compose

Minimal compose snippet to run HiveBoard from the pre-built image (no local build required):

```yaml
services:
  hiveboard:
    image: ghcr.io/boengai/hiveboard:latest
    ports:
      - "8080:8080"
    env_file: .env
    volumes:
      - hiveboard-data:/app/tmp

volumes:
  hiveboard-data:
```

See `.env.example` for required environment variables.

### Build from source

```bash
docker compose up --build    # build and start
docker compose logs -f       # follow logs
docker compose down          # stop
```

The compose file mounts `tmp/database`, `tmp/workspaces`, `tmp/agent-state`, and agent Claude config as volumes so data persists across container restarts. You can pin the Claude Code version via `CLAUDE_CODE_VERSION` in `.env`.

## How Agents Work

1. **Create a task** on the board — set the target repository and branch.
2. **Dispatch** an action via the `runAgent` mutation. Built-in actions: `plan` / `implement` / `revise`. Custom actions: `playbook:<name>` (see [Playbooks](#playbooks)).
3. **Scheduler** polls queued tasks, respecting `max_concurrent_agents`, dependency blockers (see [Task dependencies](#task-dependencies)), and secret availability.
4. **Pre-spawn resolution.** If the task declares `required_secrets` and they aren't all available, the task moves to `MISSING_SECRETS` until they're provided. Otherwise the orchestrator decrypts and injects them into the agent's env under their declared names.
5. **Spawn.** HiveBoard clones the repo into a workspace under `tmp/workspaces/{task-id}/`, renders the prompt from `packages/api/WORKFLOW.md` (including the auto-loaded scratchpad + any pending human messages + a replay of the last failing attempt if this is a retry), and starts the Claude CLI with a per-task env (`HIVEBOARD_SCRATCHPAD`, `HIVEBOARD_INBOX`, `HIVEBOARD_QUESTION`, `HIVEBOARD_PROGRESS`, `HIVEBOARD_SUBTASKS`, plus resolved secrets).
6. **Stream.** Agent output flows in real time to the board UI via GraphQL subscriptions (SSE). If Claude CLI supports `--output-format stream-json`, each turn is also parsed into a structured checkpoint row for the run log.
7. **Post-exit pipeline, in order:**
   1. If `$HIVEBOARD_QUESTION` is non-empty → task moves to `BLOCKED` with the question visible in the drawer.
   2. Else if `$HIVEBOARD_SUBTASKS` contains a manifest → create child tasks (up to 20) inheriting board/repo/branch/tags.
   3. Else if action was `implement` / `revise` → run verification commands (`lint`, `tsc`, `test`). On red, auto-dispatch `revise` with the failure output injected into the prompt (bounded by `verify.max_auto_revises`).
   4. Else → push branch and `gh pr create`.
8. **On failure** — task is retried with exponential backoff + jitter (max 5 min). Retries include a compact replay of the previous attempt in the prompt.

Each agent run is recorded in `agent_runs`, per-turn checkpoints in `agent_run_checkpoints`, verification outputs in `verification_runs`, workspace diff snapshots in `workspace_snapshots`, messages in `task_messages`, and all state transitions as task events.

### Actions

| Action | What it does | Creates PR? |
|--------|-------------|-------------|
| `plan` | Researches the codebase and outputs an implementation plan into the task body | No |
| `implement` | Implements the task, verifies locally, and opens a PR. Auto-REVISEs on verification failure (bounded). | Yes |
| `revise` | Addresses PR review comments (or verification output) with targeted changes | Yes (pushes to existing PR) |
| `playbook:<name>` | Runs a named, versioned recipe. Ships with `bump-dep`, `add-tests`, `triage-flake`, `security-review`; custom playbooks authorable via the UI. | Depends on the playbook |

### Task State Machine

```
                                         ┌──────────┐
                                         │ BLOCKED  │◀── agent wrote $HIVEBOARD_QUESTION
                                         │ (reason: │◀── time-box expired (TIMEOUT)
                                         │ Q/T/D)   │◀── blocker FAILED (DEPENDENCY_FAILED)
                                         └────┬─────┘
                                              │ answerQuestion / extendTimeBox /
                                              │ remove dependency / retry
                                              ▼
  ┌──────┐     ┌─────────────────┐    ┌────────┐     ┌─────────┐    ┌─────────┐
  │ IDLE ├───▶ │ MISSING_SECRETS │    │ QUEUED ├───▶ │ RUNNING ├───▶│ SUCCESS │
  └──┬───┘     │  (set secret to │ ◀─▶└────┬───┘     └────┬────┘    └─────────┘
     │         │   auto-unblock) │         │              │
     │         └─────────────────┘         │              ▼
     │                                     │         ┌─────────┐
     └────── runAgent / continueFailed ────┘         │ FAILED  │───▶ auto-retry
                                                     └─────────┘     or continueFailedTask
```

Block reasons (`block_reason` column): `QUESTION` (agent asked), `TIMEOUT` (time-box expired), `DEPENDENCY_FAILED` (a blocker task failed).

### Human Gates

Humans steer the board at several points. Most gates are optional — the agent can make progress alone — but some are baked into the workflow.

| Gate | What the human does | Effect |
|---|---|---|
| Create task, set target repo | Sets the scope | Task starts in `IDLE` |
| Dispatch agent | `runAgent(action, instruction?)` | Task → `QUEUED` |
| Review the plan | Reads the PLAN output | Human decides to dispatch IMPLEMENT |
| Review the PR | Leaves comments on GitHub | Dispatch REVISE to address them |
| Send a hint | `sendHint(taskId, body)` | Agent polls `$HIVEBOARD_INBOX` and may pick up the hint |
| Send a redirect | `sendRedirect(taskId, body)` | Running agent aborted; message prepended to the next prompt |
| Answer a blocked task | `answerQuestion(taskId, body)` | Task → `QUEUED` with a 30s grace window for follow-up |
| Continue a failed task | `continueFailedTask(taskId, instruction?)` | `FAILED` → `QUEUED` with a retry that includes last-attempt replay |
| Add dependencies | `addTaskDependency(taskId, blockerId)` | Task waits until blocker reaches `SUCCESS` |
| Set a time box | `setTimeBox(taskId, ms)` / `extendTimeBox` / `killTask` | Bounds how long a single run may consume |
| Manage secrets | Board Secrets UI / `setBoardSecret` / `setTaskSecret` | Required secrets injected at spawn time |
| Author or edit a playbook | `/playbooks` UI | Reusable recipe available under `action: "playbook:<name>"` |
| Merge the PR | Clicks merge on GitHub | HiveBoard does not auto-merge |

## Playbooks

Playbooks are named, versioned prompt recipes that augment the built-in PLAN/IMPLEMENT/REVISE actions. Editing a playbook creates a new immutable version; each `agent_runs` row records which version it dispatched.

Seeded on first install:

| Playbook | What it does |
|---|---|
| `bump-dep` | Bump a dependency and fix breakages |
| `add-tests` | Add missing tests for a file or directory |
| `triage-flake` | Investigate a flaky test; run 10x, analyze, propose fix |
| `security-review` | Read-only security review of a PR; posts findings as review comments (no code changes allowed) |

Dispatch via `runAgent(taskId, "playbook:bump-dep", instruction)` or through the drawer's dispatch menu. Manage playbooks at `/playbooks`.

## Task dependencies

Tasks can declare `blockedBy: [taskIds]` via `addTaskDependency`. The scheduler refuses to spawn a task until every blocker is `SUCCESS`. Cycles are rejected at mutation time with `DEPENDENCY_CYCLE`. Cross-board dependencies are rejected with `DEPENDENCY_CROSS_BOARD`.

If a blocker moves to `FAILED`, its dependents auto-move to `BLOCKED` with `block_reason='DEPENDENCY_FAILED'` so a human can decide whether to remove the edge or retry the blocker.

Agents can split their work by writing a YAML subtask manifest to `$HIVEBOARD_SUBTASKS` before exit; the orchestrator materializes each entry as a child task (up to 20 per manifest) with optional sibling dependencies.

## Per-task secrets

Tasks declare `required_secrets` (a JSON array of `UPPER_SNAKE_CASE` names). At spawn time the orchestrator resolves each name (task override → board default → missing), decrypts the value, and injects it into the agent subprocess env under its declared name. Captured output is scrubbed (literal match → `[redacted:NAME]`) before being written to `agent_runs.output`.

Values are encrypted with AES-256-GCM using a key derived from `HIVEBOARD_SECRETS_KEY` (HKDF-SHA256, `info="hiveboard:secrets:v1"`). Plaintext values NEVER appear in GraphQL responses — only names and metadata.

## Authentication

HiveBoard supports two access modes:

- **Local mode** — when accessing via `localhost`, automatically authenticates as the admin user (no login required).
- **Remote mode** — requires GitHub OAuth; users must be invited by an admin before they can log in.

### Invitations

Admins can generate invitation tokens for specific GitHub usernames. Invited users authenticate via GitHub OAuth at `/login` and gain access to the board.

## WORKFLOW.md

`packages/api/WORKFLOW.md` contains the agent prompt template and runtime config in YAML front matter. Key fields:

| Field | Default | Description |
|-------|---------|-------------|
| `polling.interval_ms` | `30000` | Orchestrator polling interval |
| `workspace.root` | `./tmp/workspaces` | Directory for per-task workspaces |
| `workspace.ttl_ms` | `259200000` | Stale workspace TTL (72 hours; 0 = never) |
| `agent.state_root` | `./tmp/agent-state` | Per-task agent-owned files (scratchpad, inbox, question, progress, subtasks) |
| `agent.max_concurrent_agents` | `5` | Concurrency limit |
| `agent.max_retry_backoff_ms` | `300000` | Max retry backoff (5 min) |
| `claude.command` | `claude` | Claude CLI binary name |
| `claude.model` | `opus` | Claude model to use |
| `claude.max_turns` | `200` | Max agent turns per run |
| `claude.permission_mode` | `bypassPermissions` | Claude CLI permission mode |
| `verify.enabled` | `true` | Run verification commands after IMPLEMENT / REVISE |
| `verify.max_auto_revises` | `1` | Cap on auto-REVISE attempts before surfacing FAILED |
| `verify.commands` | *(see WORKFLOW.md)* | Array of `{label, run, timeout_ms}` — lint / tsc / test |
| `progress.enabled` | `true` | Capture progress pings + diff snapshots during RUNNING |
| `progress.snapshot_interval_ms` | `15000` | How often to snapshot `git diff` |
| `progress.snapshot_disk_budget_mb` | `10` | Per-task patch storage budget |
| `scheduler.legacy_mode` | `false` | Fall back to pre-dependency scheduler (feature flag) |

See `packages/api/WORKFLOW.md` itself for the full set of fields and the embedded prompt template.

## Contributing

- [docs/architecture.md](docs/architecture.md) — design rationale and internals
- [docs/api-reference.md](docs/api-reference.md) — GraphQL surface
- [docs/maintainer-guide.md](docs/maintainer-guide.md) — operational runbooks + internals for maintainers
- [docs/conventions.md](docs/conventions.md) — coding conventions

## License

This project is licensed under the [Apache License 2.0](LICENSE).
