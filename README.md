# HiveBoard

HiveBoard is a local-first Kanban board for AI agent orchestration. You create tasks on the board UI, and HiveBoard dispatches autonomous coding agents (Claude CLI) to complete them. GitHub is the code host — agents open PRs there — but the board, task state, and orchestration are fully self-contained.

Inspired by [OpenAI Symphony](https://github.com/openai/symphony) and [Stripe Minions](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents).

> [!WARNING]
> HiveBoard is an engineering preview for testing in trusted environments.

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
│  Resolvers │ Orchestrator │ GitHub Client            │
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
│   └── workspaces/           # Per-task agent workspaces (git-ignored)
└── docs/
    └── architecture.md       # Architecture decisions and design rationale
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

The compose file mounts `tmp/database`, `tmp/workspaces`, and agent Claude config as volumes so data persists across container restarts. You can pin the Claude Code version via `CLAUDE_CODE_VERSION` in `.env`.

## How Agents Work

1. Create a task on the board — set the target repository and branch
2. Select an action (`PLAN`, `IMPLEMENT`, or `REVISE`) and dispatch via the `runAgent` mutation
3. The orchestrator polls every 30 seconds for queued tasks (respecting `max_concurrent_agents`)
4. HiveBoard clones the repo into an isolated workspace under `tmp/workspaces/`
5. Claude CLI runs against the task with the prompt template from `packages/api/WORKFLOW.md`
6. Agent output streams in real time via GraphQL subscriptions (SSE) to the board UI
7. On success: task body is updated (plan) or a PR is opened (implement/revise)
8. On failure: task is retried with exponential backoff + jitter (max 5 min)

Each agent run is recorded in the `agent_runs` table, and all state transitions are logged as task events for auditability.

### Actions

| Action | What it does | Creates PR? |
|--------|-------------|-------------|
| `PLAN` | Researches the codebase and outputs an implementation plan into the task body | No |
| `IMPLEMENT` | Implements the task, including e2e tests if the project has a test setup | Yes |
| `REVISE` | Addresses PR review comments with targeted changes | Yes (pushes to existing PR) |

### Task State Machine

```
IDLE → QUEUED → RUNNING → SUCCESS
                       ↘ FAILED (→ retry with backoff → QUEUED)
```

### Human Gates

Not everything is automated — certain transitions require a human to act:

| Step | Who acts | What happens |
|------|----------|-------------|
| Create task & set target repo | Human | Task starts in `IDLE` on the board |
| Dispatch agent | Human | Calls `runAgent` mutation with an action — task moves to `QUEUED` |
| Review the plan | Human | After `PLAN` succeeds, the task body is updated — human reviews before dispatching `IMPLEMENT` |
| Review the PR | Human | After `IMPLEMENT` succeeds, task moves to the "Review" column — human reviews the PR on GitHub |
| Dispatch revise | Human | After leaving PR review comments, human dispatches `REVISE` to address them |
| Merge the PR | Human | HiveBoard does not auto-merge — the human merges on GitHub |

## Authentication

HiveBoard supports two access modes:

- **Local mode** — when accessing via `localhost`, automatically authenticates as the admin user (no login required)
- **Remote mode** — requires GitHub OAuth; users must be invited by an admin before they can log in

### Invitations

Admins can generate invitation tokens for specific GitHub usernames. Invited users authenticate via GitHub OAuth at `/login` and gain access to the board.

## WORKFLOW.md

`packages/api/WORKFLOW.md` contains the agent prompt template and runtime config in YAML front matter. Key fields:

| Field | Default | Description |
|-------|---------|-------------|
| `polling.interval_ms` | `30000` | Orchestrator polling interval |
| `workspace.root` | `./tmp/workspaces` | Directory for per-task workspaces |
| `workspace.ttl_ms` | `259200000` | Stale workspace TTL (72 hours; 0 = never) |
| `claude.command` | `claude` | Claude CLI binary name |
| `claude.model` | `opus` | Claude model to use |
| `claude.max_turns` | `200` | Max agent turns per run |
| `claude.permission_mode` | `bypassPermissions` | Claude CLI permission mode |
| `agent.max_concurrent_agents` | `5` | Concurrency limit |
| `agent.max_retry_backoff_ms` | `300000` | Max retry backoff (5 min) |

## Contributing

See [docs/architecture.md](docs/architecture.md) for architecture decisions and design rationale.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
