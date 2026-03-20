# HiveBoard Architecture

Living documentation for technical decisions in the `feat/owned-board` evolution.

Last updated: 2026-03-20

---

## Overview

HiveBoard moved from a GitHub Projects V2 integration (polling/webhooks → external board state) to a **standalone owned board**: a self-contained SQLite-backed Kanban board with a React frontend and GraphQL API. GitHub is still the code host (PRs are created there), but all board state, task management, and orchestration are local.

---

## System Architecture

```
Browser (localhost:5173)
  React + Vite + TanStack Router + Tailwind + Zustand
  Board View | Task Drawer | Agent Logs
       |
       | GraphQL over HTTP + SSE (subscriptions)
       |
API Server (localhost:8080)
  Bun + GraphQL Yoga
  Resolvers | Orchestrator | GitHub PR Client
       |
  Bun SQLite → tmp/database/hiveboard.db
```

The API and web are separate Bun workspace packages (`packages/api`, `packages/web`) started together with `bun run dev`.

---

## Key Technology Decisions

### Runtime: Bun

Used throughout — native SQLite, fast test runner, native `.env` loading, workspace support. No Node.js required.

### Database: Bun SQLite (`bun:sqlite`)

Zero-dependency embedded database. Schema is defined in `packages/api/src/db/schema.ts` and auto-migrated on startup (`migrate.ts`). Primary keys are ULIDs (time-sortable, no collision risk, stored as TEXT).

No ORM — raw SQL via the Bun SQLite API.

### API: GraphQL Yoga

Bun-native GraphQL server. Handles queries, mutations, and subscriptions in one server. Real-time updates use GraphQL Subscriptions over SSE (Server-Sent Events) — no WebSocket server needed. Schema is defined as SDL in `typeDefs.ts`, resolved in `resolvers.ts`.

### Real-time: GraphQL Subscriptions (SSE)

The frontend subscribes to task updates, agent log lines, and board state changes over SSE. The API uses an in-memory pub/sub (`pubsub.ts`) to fan out events to active subscribers. No external message broker.

### Frontend: React + Vite

- **TanStack Router** — type-safe routing with `lazyRouteComponent()`
- **Zustand** — all client state (board state, UI state, settings). No TanStack Query or Context API for state.
- **graphql-request** — lightweight fetch-based GraphQL client (no cache layer; Zustand is the cache)
- **graphql-sse** — SSE-based subscription client, paired with Yoga's SSE transport
- **Tailwind CSS v4** — CSS-first config (no `tailwind.config.js`), OKLCH design tokens
- **tailwind-variants (`tv()`)** — replaces `cva()`/shadcn patterns for component variants
- **Radix UI primitives** — dialog, dropdown-menu, select, switch, tabs, etc.
- **vaul** — touch-friendly drawer (wraps Radix Dialog), used for the Task Drawer
- **@dnd-kit** — drag-and-drop for the Kanban columns and card reordering
- **Motion (Framer Motion v12)** — `LazyMotion` at root, `motion/react` for animations

No shadcn/ui, no ESLint/Prettier (Biome only), no urql, no icon libraries (hand-rolled SVGs).

### Monorepo: Bun Workspaces

```
hiveboard/
├── package.json          # root — workspaces: ["packages/*"]
├── packages/
│   ├── api/              # GraphQL Yoga + SQLite + orchestrator
│   └── web/              # React + Vite
```

Root scripts delegate to workspaces via `bun run --filter`. A single `bun install` at the root installs all workspace dependencies.

---

## Data Model (SQLite)

Core tables (defined in `packages/api/src/db/schema.ts`):

- **tasks** — Kanban cards: id (ULID), title, description, column, repo target, status, timestamps
- **task_comments** — User/agent comments on tasks
- **task_timeline** — Audit log of state transitions and agent events
- **agent_runs** — Records of agent executions: task id, status, log path, timestamps

---

## Orchestrator

Lives in `packages/api/src/orchestrator/`. When a task is moved to a triggering column:

1. A workspace is created under `tmp/workspaces/<task-id>/`
2. The target repo is cloned into the workspace
3. Claude CLI is invoked with the rendered `WORKFLOW.md` prompt
4. Agent stdout/stderr is streamed to the task's timeline in real time via pub/sub
5. On completion: task moves to "Review", a PR is opened via the GitHub API
6. On failure: exponential backoff retry up to `agent.max_retry_backoff_ms`

Concurrency is bounded by `agent.max_concurrent_agents` (default: 5).

---

## GitHub Integration (Slim)

The previous version depended on GitHub Projects V2 for all board state. Now GitHub is used only for:

- **PR creation** — `packages/api/src/github/` contains only the PR creation client
- **Auth** — Personal access token (`GITHUB_TOKEN`) or GitHub App credentials

No webhooks, no polling GitHub Projects, no Cloudflare tunnel required.

---

## Design System

Linear.app-inspired minimal dark UI with a Bee palette:

- **Surfaces**: 3-level layering (page → raised → overlay) using near-pure warm-tinted grays
- **Accent**: Honey/amber (OKLCH hue ~85) for primary actions, focus rings, and active states
- **Typography**: Inter (sans), JetBrains Mono (code), 14px base (`text-body`)
- **Semantic colors**: muted success/error/info/warning in OKLCH for badges and status indicators

All design tokens are CSS custom properties in `packages/web/src/index.css` using Tailwind v4's `@theme` directive.

---

## Frontend Component Conventions

- **Barrel exports** — every directory has an `index.ts`
- **Named exports only** — never `export default`
- **One component per file**
- **Types in `src/types/`** — mirroring `src/` structure
- **Feature components are self-contained** — manage own state, composed from `components/common/`
- **No Context API for state** — Zustand stores only

---

## What Was Removed

Compared to the original HiveBoard:

| Removed | Replaced by |
|---------|-------------|
| GitHub Projects V2 board | Owned SQLite-backed board |
| Webhook server + secret | Not needed (no external events) |
| Cloudflare tunnel | Not needed |
| Label-driven workflow (`action:*`, `repo:*`, `status:*`) | Board column + task fields |
| `WORKFLOW.md` YAML config for board columns | Database schema |
| Polling GitHub Projects API | Direct DB reads |
