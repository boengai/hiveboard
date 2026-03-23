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
├── package.json          # root — workspaces: ["packages/*"]
├── packages/
│   ├── api/              # GraphQL Yoga API server + orchestrator + SQLite
│   └── web/              # React + Vite frontend
├── tmp/
│   ├── database/         # SQLite database (git-ignored)
│   └── workspaces/       # Per-task agent workspaces (git-ignored)
└── WORKFLOW.md           # Agent prompt template + runtime config
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
# Option A: Personal access token
GITHUB_TOKEN=ghp_your_token_here   # needs repo scope

# Option B: GitHub App (set these INSTEAD of GITHUB_TOKEN)
# GITHUB_APP_ID=123456
# GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
# GITHUB_APP_INSTALLATION_ID=12345678

# Optional — defaults shown
# API_PORT=8080
# WEB_PORT=5173
```

## Available Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start both API and web in watch mode |
| `bun run dev:api` | Start API server only |
| `bun run dev:web` | Start Vite dev server only |
| `bun run build:web` | Build frontend for production |
| `bun run tsc` | Type-check all packages |
| `bun run test` | Run tests |
| `bun run fmt` | Auto-fix formatting and lint (Biome) |
| `bun run lint` | Lint only |
| `bun run check` | Run lint + fmt + test + tsc + build |

## Docker

```bash
docker compose up --build    # build and start
docker compose logs -f       # follow logs
docker compose down          # stop
```

The compose file mounts `tmp/database` and `tmp/workspaces` as volumes so data persists across container restarts. Set `ANTHROPIC_API_KEY` in `.env` or mount your host Claude config:

```bash
# add to docker-compose.yml volumes if needed
- ~/.claude:/home/hiveboard/.claude
```

## How Agents Work

1. Create a task on the board and set the target repository
2. Select an action (`plan`, `implement`, or `revise`) and dispatch the agent
3. HiveBoard clones the repo into an isolated workspace under `tmp/workspaces/`
4. Claude CLI (Opus) runs against the task with the prompt from `WORKFLOW.md`
5. On success: task body is updated (plan) or PR is opened (implement/revise)
6. On failure: task is retried with exponential backoff

Task state updates stream in real time via GraphQL subscriptions (SSE).

### Actions

| Action | What it does | Creates PR? |
|--------|-------------|-------------|
| `plan` | Researches the codebase and outputs an implementation plan into the task body | No |
| `implement` | Implements the task, including e2e tests if the project has a test setup | Yes |
| `revise` | Addresses PR review comments with targeted changes | Yes |

## WORKFLOW.md

`WORKFLOW.md` contains the agent prompt template and runtime config in YAML front matter. Key fields:

| Field | Default | Description |
|-------|---------|-------------|
| `workspace.root` | `./tmp/workspaces` | Directory for per-task workspaces |
| `workspace.ttl_ms` | `259200000` | Stale workspace TTL (72 hours; 0 = never) |
| `claude.command` | `claude` | Claude CLI binary name |
| `claude.model` | `opus` | Claude model to use |
| `claude.max_turns` | `200` | Max agent turns per run |
| `agent.max_concurrent_agents` | `5` | Concurrency limit |
| `agent.max_retry_backoff_ms` | `300000` | Max retry backoff (5 min) |

## Contributing

See [docs/architecture.md](docs/architecture.md) for architecture decisions and design rationale.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
