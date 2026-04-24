# Architecture

> Last updated: 2026-04-21

HiveBoard is a local-first Kanban board that orchestrates autonomous coding
agents. Tasks live in a SQLite database on your machine; agents (Claude CLI)
run against cloned repositories and open PRs on GitHub. There is no cloud
dependency beyond GitHub as the code host.

The April 2026 "orchestration wave" turned HiveBoard from a thin
Kanban-with-agents shell into a real orchestration surface: agents have
persistent memory across runs, can block on human input, run under
dependency / time-box / secrets constraints, and are watched by a
self-verify loop that gates PR creation. This document explains the shape of
those pieces, not the full API surface.

---

## 1. System Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Browser  (localhost:5173)                                   │
│  React 19 + Vite + TanStack Router + Tailwind + Zustand      │
│                                                              │
│  Board View  ·  Task Drawer (tabs: Scratchpad · Progress ·   │
│  Timeline · Messages · Verification · Events · Comments)     │
│  Playbooks page                                              │
└───────┬───────────────────────────────┬──────────────────────┘
        │  GraphQL (queries/mutations)  │  SSE (subscriptions)
        ▼                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  API Server  (localhost:8080)                                        │
│  Bun + GraphQL Yoga                                                  │
│                                                                      │
│  ┌─────────────┐  ┌────────────────────────────┐  ┌────────────────┐ │
│  │  Resolvers   │  │        Orchestrator        │  │ GitHub client  │ │
│  │  (CRUD +    │  │  scheduler (dep-aware)     │  │ (token /       │ │
│  │  playbook,  │──┤  pre-spawn pipeline        │  │  GitHub App)   │ │
│  │  messages,  │  │  post-exit pipeline        │  │                │ │
│  │  secrets,   │  │  retry / time-box timers   │  │                │ │
│  │  verify)    │  │  snapshot + progress loops │  │                │ │
│  └──────┬──────┘  └──────┬──────────────────┬──┘  └───────┬────────┘ │
│         │                │                  │             │          │
│         ▼                ▼                  ▼             │          │
│  ┌───────────────────────────────┐   ┌────────────┐       │          │
│  │  Bun:sqlite  (WAL mode)       │   │ SecretStore│       │          │
│  │  hiveboard.db                 │   │ AES-256-GCM│       │          │
│  │  — 20 tables                  │   │ KEK via    │       │          │
│  └───────────────────────────────┘   │ HKDF-SHA256│       │          │
│                                      └────────────┘       │          │
│                                                           │          │
│        ┌─────────────────────────────────────┐            │          │
│        │  Claude CLI subprocess              │◄───────────┘          │
│        │  --output-format stream-json        │                       │
│        │  reads env: HIVEBOARD_SCRATCHPAD,   │                       │
│        │  _INBOX, _QUESTION, _PROGRESS,     │                       │
│        │  _SUBTASKS, plus declared secrets   │                       │
│        └──────────┬──────────────────────────┘                       │
│                   │                                                   │
│                   ▼                                                   │
│        ┌──────────────────────────────┐   ┌─────────────────────┐    │
│        │ tmp/workspaces/{repo}/task-*│   │ tmp/agent-state/    │    │
│        │ (git clone; ttl-swept 72h)  │   │   {task-id}/        │    │
│        │                              │   │ scratchpad.md       │    │
│        └──────────────────────────────┘   │ inbox.md            │    │
│                                           │ question.md         │    │
│                                           │ progress.ndjson     │    │
│                                           │ subtasks.yaml       │    │
│                                           │ (orphan-swept 1h)   │    │
│                                           └─────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

**Key insight:** the API server is *both* a GraphQL API for the web client and
an agent orchestrator. The orchestrator polls the database for queued tasks,
runs a pre-spawn resolution pipeline (secrets → dependencies → env → prompt),
spawns the Claude CLI, watches for progress / diff snapshots during the run,
and runs a post-exit pipeline (scratchpad, question, subtasks, verify, PR)
whose order is load-bearing (see §5).

---

## 2. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Runtime | **Bun** v1.1+ | Fast startup, native SQLite driver, built-in TS support |
| API | **GraphQL Yoga** | Lightweight, Bun-compatible, built-in SSE subscriptions |
| Database | **Bun:sqlite** (WAL mode) | Zero-dependency embedded DB; WAL allows concurrent reads during agent writes |
| Schema validation | **Zod v4** | Config validation for WORKFLOW.md front matter |
| Templating | **Mustache** | Prompt rendering (WORKFLOW.md blocks + shared partials + playbook bodies) |
| Encryption | **Node `crypto` (AES-256-GCM, HKDF-SHA256)** | Per-task secrets envelope; no external KMS dependency |
| Frontend | **React 19 + Vite** | Fast HMR, standard ecosystem |
| Routing | **TanStack Router** | Type-safe file-based routing |
| State | **Zustand** | Minimal boilerplate store for board state and optimistic updates |
| Styling | **Tailwind CSS + tailwind-variants** | Utility-first; `tv()` for component variant composition |
| Monorepo | **Bun workspaces** | `packages/api` + `packages/web` in one repo |
| Linting | **Biome** | Single tool for formatting + linting, fast |
| Agent | **Claude CLI** (`--output-format stream-json` when supported) | Subprocess per task; NDJSON line events drive checkpoint capture |
| Code host | **GitHub** | PR creation, review comment fetching, issue management |

---

## 3. On-Disk Layout

HiveBoard keeps two parallel per-task trees under `tmp/`. They have
deliberately different lifecycles.

| Tree | Path | Owner | Lifecycle |
|------|------|-------|-----------|
| Workspace | `tmp/workspaces/{repo}/task-*` | orchestrator | created by `after_create` hook; swept on 72 h TTL |
| Agent state | `tmp/agent-state/{task-id}/` | agent + orchestrator | created lazily on first write; preserved across runs; hourly orphan-sweep |

**Workspace** is the git clone the agent edits — ephemeral, byte-for-byte
rebuildable, and legitimately expensive to keep around.

**Agent state** is where the agent's persistent memory and I/O files live.
It is deliberately *decoupled* from workspace TTL:

- Directory is lazily created the first time any writer (orchestrator
  seeding the empty `inbox.md`; agent appending to `scratchpad.md`) touches
  it.
- Path is always `{config.agent.state_root}/{task-id}/` with
  `state_root` defaulting to `./tmp/agent-state`. Task id is ULID-validated
  before any filesystem access (guards against `../` traversal through
  user-supplied fields).
- Files inside: `scratchpad.md` (Spec A), `inbox.md`, `question.md`
  (Spec B), `progress.ndjson` (Spec D), `subtasks.yaml` (Spec E).
- **Never** touched by the 72 h workspace sweeper. Scratchpad continuity
  across PLAN → IMPLEMENT → REVISE → retries is the whole point.
- Deleted only by:
  - The task hard-delete resolver (via `deleteAgentState(taskId)`,
    wrapped in try/catch so a filesystem error cannot block DB deletion).
  - The hourly orphan sweep (`sweepOrphanAgentStateDirs`), which
    removes any top-level directory whose name is not a ULID of a live or
    archived task — this handles the race where a task is deleted while
    the agent was still writing.
- Archived tasks are considered live for cleanup — archive is reversible.

Cleanup lives in `packages/api/src/workspace/agent-state.ts`; the sweeper
is invoked from the existing workspace cleanup tick.

---

## 4. Agent Status State Machine

Before the orchestration wave, agent status was
`IDLE → QUEUED → RUNNING → SUCCESS | FAILED`. It now includes two new
terminal-ish states and a block-reason discriminator.

```
                                                       ┌─ extendTimeBox ─┐
                                                       │                 │
                                                       │                 ▼
  ┌──────┐   dispatch    ┌────────┐   spawn    ┌──────────┐    abort    ┌───────┐
  │ IDLE │──────────────▶│ QUEUED │───────────▶│ RUNNING  │────────────▶│BLOCKED│
  └──────┘               └────┬───┘            └────┬─────┘ QUESTION /  │(reason│
         ▲                    │                     │       TIMEOUT /   │  set) │
         │                    │                     │       DEPENDENCY_ └──┬────┘
         │                    │                     │          FAILED      │
         │              missing secrets             │                      │
         │                    ▼                     ▼                      │
         │           ┌──────────────────┐    ┌─────────┐                   │
         │           │ MISSING_SECRETS  │    │ SUCCESS │ ◀── answerQuestion│
         │           └────────┬─────────┘    │ FAILED  │                   │
         │                    │              └─────────┘                   │
         │                    │   setBoardSecret /                         │
         │                    │   setTaskSecret (+5s grace)                │
         │                    ▼                                            │
         │                ┌────────┐                                       │
         └────────────────┤ QUEUED │◀──────────────────────────────────────┘
                          └────────┘   (also: continueFailedTask from FAILED,
                                        redirect from RUNNING, auto-REVISE
                                        dispatch after verify fail)
```

New values and reasons:

| Status | Introduced by | Reason field | How to leave |
|--------|---------------|--------------|--------------|
| `BLOCKED` | Spec B (question), E (timeout / dep-failed) | `block_reason ∈ {QUESTION, TIMEOUT, DEPENDENCY_FAILED}` | `answerQuestion` (QUESTION, +30 s grace) · `extendTimeBox` / `killTask` (TIMEOUT) · blocker completes / deps removed (DEPENDENCY_FAILED) |
| `MISSING_SECRETS` | Spec H | n/a | `setBoardSecret` / `setTaskSecret` re-resolves and requeues with +5 s grace |

Key transitions:

- **RUNNING → BLOCKED (QUESTION)** — agent writes to `$HIVEBOARD_QUESTION`
  and exits. A `task_messages` row with `kind='question'` is inserted; the
  file wins even over a non-zero exit code.
- **RUNNING → BLOCKED (TIMEOUT)** — the per-task
  `setTimeout(time_box_ms)` fires and calls `abortController.abort('TIMEOUT')`.
  The post-exit handler sees `runState.abortReason === 'TIMEOUT'` and
  short-circuits the SUCCESS/FAILED path (and the question flow — the
  question file is not trusted after a mid-thought kill).
- **anything → BLOCKED (DEPENDENCY_FAILED)** — the dependency cascade
  runs when a task transitions to FAILED; every dependent of the failed
  task moves to BLOCKED with this reason.
- **RUNNING → QUEUED (redirect)** — `sendRedirect` mutation aborts via the
  existing `AbortController`; the orchestrator requeues with
  `queue_after = now + 5s`. The redirect message remains `delivered_at=NULL`
  until the next spawn injects it.
- **QUEUED → MISSING_SECRETS** — the pre-spawn secrets gate refuses to
  spawn when any declared `required_secrets` name has no task-level
  override and no board default.

The `BLOCKED`/`MISSING_SECRETS` states are **additive** — existing tasks
are unaffected because no task declares a time-box or required secrets by
default, and the agent only writes a question if the WORKFLOW.md prompt
tells it to (which it now does).

---

## 5. Orchestration Pipelines

Every dispatch walks two ordered pipelines.

### 5.1 Pre-spawn resolution pipeline

Location: the top of `Orchestrator#spawnTask` in
`packages/api/src/orchestrator/orchestrator.ts`.

```
┌──────────────────────────────────────────────┐
│ 1. Dependency check                          │
│    scheduler SELECT already filters out      │
│    tasks with unresolved blockers, but       │
│    re-verification is cheap                  │
└───────────────┬──────────────────────────────┘
                ▼
┌──────────────────────────────────────────────┐
│ 2. Secrets resolution  (Spec H)              │
│    resolveSecretsForTask()                   │
│      task_secrets → board_secrets → missing  │
│    any missing?                              │
│      - agent_status = MISSING_SECRETS        │
│      - publish taskMissingSecretsChanged     │
│      - return early (no spawn)               │
│    all present?                              │
│      - decrypt in orchestrator memory        │
│      - carry plaintext env forward           │
└───────────────┬──────────────────────────────┘
                ▼
┌──────────────────────────────────────────────┐
│ 3. Env construction  (agent/env.ts)          │
│    HIVEBOARD_* paths (scratchpad, inbox,     │
│    question, progress, subtasks)             │
│    + GIT_* identity, GH_CONFIG_DIR, askpass  │
│    + decrypted secrets under DECLARED names  │
│      (NOT HIVEBOARD_*) — bypasses the        │
│      ALLOWED_ENV_VARS allowlist              │
│    GITHUB_TOKEN is explicitly DENIED for the │
│    agent subprocess; git / gh use on-disk    │
│    token files instead                       │
└───────────────┬──────────────────────────────┘
                ▼
┌──────────────────────────────────────────────┐
│ 4. Prompt rendering  (agent/prompt.ts OR     │
│                      playbooks/render.ts)    │
│    - readScratchpad()  → injected as         │
│      {{{scratchpad}}} (64 KB tail-capped)    │
│    - undelivered human messages (Spec B)     │
│      fetched; marked delivered AFTER spawn   │
│      handle obtained                         │
│    - previousAttemptReplay built from        │
│      agent_run_checkpoints if retry_count>0  │
│    - verificationFailures from last agent_run│
│      if auto-REVISE                          │
│    - rendered via shared Mustache partials   │
└───────────────┬──────────────────────────────┘
                ▼
┌──────────────────────────────────────────────┐
│ 5. Bun.spawn + stream-json line parser       │
│    + per-task wall-clock setTimeout          │
│    + progress-watcher on progress.ndjson     │
│    + snapshotLoop (15 s git-diff cadence)    │
└──────────────────────────────────────────────┘
```

**Why this order matters:**

- Dependency check **before** secrets so we don't decrypt plaintext for a
  task that isn't runnable yet (plaintext lifetime minimization).
- Secrets **before** env construction so a missing-secret task never even
  has an env built (fail fast).
- Secrets **before** prompt rendering so the prompt's "Secrets available"
  block lists real names, not aspirational ones.
- Messages marked delivered **after** `Bun.spawn` returns a process
  handle, so if spawn throws the messages remain `delivered_at=NULL` and
  the next attempt picks them up.

### 5.2 Post-exit pipeline

Runs for every agent process exit, successful or not. Ordered chain:

```
┌──────────────────────────────────────────────────────────┐
│  agent process exited                                    │
└───────────────┬──────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────┐
│ A. Time-box short-circuit                                │
│    runState.abortReason === 'TIMEOUT'?                   │
│      → BLOCKED (TIMEOUT), skip everything below          │
└───────────────┬──────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────┐
│ B. Scratchpad capture is AGENT-AUTHORED                  │
│    nothing to do here; the agent appended via `>>`       │
│    during its run. orchestrator only injects on next run.│
└───────────────┬──────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────┐
│ C. Question detection (Spec B)                           │
│    readQuestion(task.id)                                 │
│      non-empty?                                          │
│        → insert task_messages row (kind=question)        │
│        → BLOCKED (QUESTION)                              │
│        → skip verify / PR / subtask processing           │
│    wins even over non-zero exit codes                    │
└───────────────┬──────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────┐
│ D. Subtask manifest (Spec E)                             │
│    parseSubtasksManifest($HIVEBOARD_SUBTASKS)            │
│      valid?  → createSubtasksFromManifest (cap 20)       │
│      invalid? → event logged, file moved aside, continue │
│    Runs on SUCCESS only. Does NOT gate PR creation.      │
└───────────────┬──────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────┐
│ E. Verification gate (Spec C)                            │
│    task.action in (implement, revise) AND                │
│    config.verify.enabled                                 │
│      → verifyAndGate() runs each command sequentially    │
│      any failure? → dispatchVerificationFailure():       │
│        - verify_attempt_count++                          │
│        - if > max_auto_revises → task FAILED             │
│        - else → auto-REVISE queued with verification     │
│          output baked into the next prompt via the       │
│          auto_revise_from_verification partial           │
│      all pass? → fall through to PR creation             │
└───────────────┬──────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────┐
│ F. PR creation / column move / events                    │
│    implement + revise → PR parsed from output (regex),   │
│      fallback: gh API findPrByHead; move to Review       │
│    plan → move to Todo, extract plan body                │
│    research → stays in place                             │
│    publish TASK_UPDATED; publish taskUpdated for all     │
│      direct dependents so their UI chain-link badges     │
│      refresh                                             │
└──────────────────────────────────────────────────────────┘
```

**Why this order matters:**

- Question **wins over verify**: a blocked-on-uncertainty agent has
  almost certainly not finished its work; verification would just be
  noise.
- Subtasks **always materialize** on SUCCESS regardless of verify outcome.
  They are forward work; a parent's verify failure is an orthogonal
  problem. However, they do NOT gate PR creation — a parent can open a
  PR while children are still queued (parent/child roll-up decides
  ultimate SUCCESS).
- Verification **gates PR creation**: HiveBoard only opens a PR when the
  project's own lint/tsc/test exit 0. Humans see FAILED only when the
  agent genuinely can't recover within `max_auto_revises`.

---

## 6. Real-Time & Subscription Surface

GraphQL Yoga uses **Server-Sent Events** (SSE) for subscriptions — no
WebSocket server required. The PubSub channels grew to match the new UI
surfaces.

```
Browser                                    API Server
  │                                           │
  │── GET /graphql?query=subscription ───────▶│
  │                                           │
  │◀── Content-Type: text/event-stream ───────│
  │                                           │
  │    ┌──────────────────────────────────┐   │
  │    │  PubSub topics:                  │   │
  │    │  • TASK_UPDATED     (by boardId) │   │
  │    │  • AGENT_LOG        (by taskId)  │   │
  │    │  • TASK_EVENT       (by taskId)  │   │
  │    │  • COMMENT_ADDED    (by taskId)  │   │
  │    │  • SCRATCHPAD       (by taskId)  │   │
  │    │  • TASK_MESSAGE     (by taskId)  │   │
  │    │  • TASK_PROGRESS    (by taskId)  │   │
  │    │  • WORKSPACE_SNAPSHOT(by taskId) │   │
  │    │  • VERIFICATION_RUN (by taskId)  │   │
  │    │  • AGENT_CHECKPOINT (by taskId)  │   │
  │    │  • TASK_MISSING_SECRETS (by tid) │   │
  │    └──────────────────────────────────┘   │
  │                                           │
  │◀── data: { ... } ─────────────────────────│  (on each publish)
```

The frontend Zustand store still merges `taskUpdated` via
`mergeTaskUpdate()`. The drawer's tabs are each backed by their own
subscription and hydrated from a query on mount.

---

## 7. Playbook Prompt Rendering & Shared Partials

Prompt rendering used to live entirely inside `WORKFLOW.md`: YAML front
matter plus one big Mustache template. Playbooks broke that assumption —
they bring their own body but still need the same scratchpad / messages /
progress / question / subtasks scaffolding.

Resolution: extract the five cross-cutting blocks into Mustache
**partials** under `packages/api/src/agent/prompt-partials/`:

- `scratchpad.mustache`
- `messages.mustache`
- `progress.mustache`
- `question.mustache`
- `subtasks.mustache`

Both paths load the same partials via `loadPromptPartials()`:

- **Built-in actions** — `WORKFLOW.md` references the partials with
  Mustache's `{{> name}}` syntax. Rendered output for PLAN / IMPLEMENT /
  REVISE is byte-identical to the pre-wave release.
- **Playbooks** — `packages/api/src/playbooks/render.ts` builds a
  header/footer around the playbook's own body:

  ```
  header (task + retry replay)
    {{> scratchpad}}
    {{> progress}}
    {{> messages}}
  [playbook body]
    {{> question}}
    {{> subtasks}}
  footer (unattended session instructions)
  ```

Same partials, same context shape → agent behavior is consistent whether
a run is an action or a playbook. Playbooks are stored in the DB
(`playbooks` + `playbook_versions`, immutable versions), and the run's
chosen version id is recorded on `agent_runs.playbook_version_id` so the
audit trail shows which recipe produced which output.

Four playbooks ship seeded on first migration: `bump-dep`, `add-tests`,
`triage-flake`, `security-review`. Dispatch is via
`action: "playbook:<name>"` (the `BoardAction` GraphQL enum was removed in
favor of a plain `String` to accommodate this — a breaking change for
external consumers, but the HiveBoard web client is the only in-repo
consumer).

---

## 8. Bidirectional Channel Transport

The human ↔ agent channel has two kinds of human messages with different
urgencies, two kinds of agent outputs, and one shared storage layer.

```
                       task_messages
             ┌─────────────────────────────────┐
             │ id, task_id, author_type, kind, │
             │ body, delivered_at, created_at  │
             └──────┬──────────────────────────┘
                    │
      ┌─────────────┼───────────────────────────┐
      │             │                           │
      ▼             ▼                           ▼
  ┌────────┐  ┌──────────┐                  ┌──────────┐
  │  HINT  │  │ REDIRECT │                  │ QUESTION │  agent-authored
  └───┬────┘  └─────┬────┘                  │  ANSWER  │  human reply
      │             │                       └──────────┘
      │             │
      ▼             ▼
┌─────────────┐ ┌──────────────────┐
│ if RUNNING  │ │ abort via        │
│ append file │ │ AbortController  │
│ $INBOX      │ │ requeue +5 s      │
│ and set     │ │ (message stays   │
│ delivered   │ │  undelivered)    │
│ else wait   │ │                  │
│ for next    │ │                  │
│ spawn       │ │                  │
└─────────────┘ └──────────────────┘
```

The core contract is **"inject undelivered on next spawn"**. The pre-spawn
pipeline's prompt-rendering step queries all `task_messages` where
`author_type='human' AND delivered_at IS NULL`, renders them via the
`messages.mustache` partial, and only marks them delivered after
`Bun.spawn` successfully returns a process handle. Two consequences:

1. **Hints delivered mid-run** — appended to `$HIVEBOARD_INBOX` via
   shell `>>`; the agent's prompt instructs it to `cat "$HIVEBOARD_INBOX"`
   at natural checkpoints. Once written, `delivered_at` is set so the
   next spawn doesn't re-inject.
2. **Redirects** — aborted RUNNING agents leave their redirect row
   `delivered_at=NULL`. The orchestrator's existing reconciliation path
   detects the aborted state, requeues the task (+5 s grace to batch
   follow-up messages), and the next spawn's injection pass picks up the
   redirect along with anything else that arrived during the window.

Questions flow the other way: the agent writes to
`$HIVEBOARD_QUESTION` and exits; the post-exit pipeline's question-detection
step inserts an `author_type='agent', kind='question'` row and transitions
the task to `BLOCKED (QUESTION)`. On `answerQuestion`, the orchestrator
inserts the human's `kind='answer'` row and requeues with +30 s grace so
additional follow-ups can batch.

---

## 9. Checkpoint Capture via stream-json

The Claude CLI has two output modes: `json` (one big blob on exit) and
`stream-json` (newline-delimited turn events in real time). We need the
latter to capture per-turn checkpoints for retry replay, but older CLIs
don't support it.

**Capability gating** (`packages/api/src/agent/capability.ts`):
`detectCheckpointSupport()` runs at boot, greps `claude --help` for
`stream-json`, and sets a module-level flag. If absent, the orchestrator
falls back to `--output-format json` and the checkpoint feature is
transparently disabled — older CLIs still work.

**NDJSON line parser** (`packages/api/src/agent/ndjson-line-parser.ts`):
the runner's stdout reader pipes chunks into a line parser that buffers
partial lines across chunk boundaries. Each completed line is JSON-parsed
and passed to `summarizeEvent()`.

**`summarizeEvent()`** (`packages/api/src/agent/summarize.ts`): pure
function mapping a parsed event to a `{turn, kind, summary, rawBytes}`
record or `null`. Summaries are capped at 2 KB per row (assistant text
keeps first+last 200 chars; tool uses keep a compact arg summary; tool
results omit contents and record only `exit=... bytes=...`). A worst-case
200-turn run contributes ≤ ~400 KB to `agent_run_checkpoints` — small
enough to keep indefinitely.

**Retry injection** (`packages/api/src/agent/checkpoint-replay.ts`):
when `retry_count > 0`, `buildPreviousAttemptReplay()` selects a subset of
checkpoints from the prior failed run — last 20 turns, every error event,
plus sampled tool uses (Write/Edit heavily weighted), capped at 50
entries. The selection is rendered into a `Previous attempt replay`
block in the prompt so the agent can skip known dead ends rather than
restart from zero.

**Manual continue** — `continueFailedTask` is the human's way to trigger
the same replay path explicitly on a FAILED task: increments `retry_count`,
transitions to QUEUED, optionally appends guidance to `agent_instruction`.

---

## 10. Secrets: Encryption and Scrubbing

Per-task secrets have to survive three threats: disk exfiltration of the
DB file, GraphQL leaking plaintext, and the agent itself accidentally
echoing a value into a captured output.

**Key material** — `HIVEBOARD_SECRETS_KEY` env var (base64, 32 bytes
after decode). At boot (`initSecretsFromEnv`), we derive a KEK via
HKDF-SHA256 with info string `"hiveboard:secrets:v1"`. Missing or
malformed key → feature disabled; tasks with declared `required_secrets`
transition to `MISSING_SECRETS` rather than silently running without
them.

**Envelope** — every row in `board_secrets` / `task_secrets` stores
`nonce (12 B) || ciphertext || auth_tag (16 B)` (AES-256-GCM). A key
rotation is intentionally destructive: existing ciphertext becomes
unreadable and the UI shows "re-enter" affordances, rather than
silently losing data.

**Plaintext lifetime** — plaintext only exists in three places:
1. In the user's browser at input time (delivered over TLS / loopback).
2. In the orchestrator's memory, for the ~ms between `resolveSecretsForTask`
   and `Bun.spawn`, as values in a `Record<string, string>`.
3. In the spawned agent subprocess's env, under the user-declared names
   (NOT under `HIVEBOARD_*`).

Crucially: **plaintext never enters GraphQL responses.** No resolver,
query, subscription, or field ever returns the encrypted bytes or a
decrypted value. Only names, descriptions, and metadata (created-by,
timestamps) are queryable. This is verified in unit tests that inspect
the raw JSON response body, not just the TypeScript types.

**Scrubbing** — defense in depth for the "agent echoes a value" case.
After the CLI process exits, `scrubSecrets()`
(`packages/api/src/secrets/scrubber.ts`) performs a single-pass
literal-match replace across `AgentResult.output` and `.error`, replacing
each resolved value with `[redacted:NAME]`. Longer values win ties. The
scrubber runs post-run only — live-stream chunks forwarded to
`AGENT_LOG` subscribers are **not** retroactively scrubbed, so the
primary defense remains the prompt instruction "never echo these values".

---

## 11. Scheduling: Dependencies + Time-Boxing

The previous scheduler was a flat
`WHERE agent_status='queued' ORDER BY updated_at ASC LIMIT N`. Two
extensions layer onto that query.

**Dependency-aware SELECT** — the poll query now anti-joins
`task_dependencies`:

```sql
SELECT t.* FROM tasks t
WHERE t.agent_status = 'queued'
  AND t.action IS NOT NULL
  AND (t.queue_after IS NULL OR t.queue_after <= datetime('now'))
  AND NOT EXISTS (
    SELECT 1 FROM task_dependencies d
    JOIN tasks b ON b.id = d.blocker_id
    WHERE d.task_id = t.id AND b.agent_status != 'success'
  )
ORDER BY
  (SELECT COUNT(*) FROM task_dependencies d2 WHERE d2.task_id = t.id) DESC,
  t.updated_at ASC
LIMIT ?;
```

The `NOT EXISTS` clause filters out any task that still has a blocker
whose status isn't `success`. The `ORDER BY` prefers deeper nodes
(children over parents) so parallel frontiers clear first. Cycle
detection runs on `addTaskDependency` by walking the graph forward from
the proposed blocker and rejecting if the source task is reachable. A
`scheduler.legacy_mode` config flag reverts to the old flat query for
production escape-hatch situations.

When a blocker fails, a cascade fires (`cascadeDependencyFailure`):
direct dependents transition to `BLOCKED (DEPENDENCY_FAILED)` so the
human is explicitly surfaced rather than silently left queued forever.

**Per-task wall-clock timer** — when spawning a task with
`time_box_ms > 0`, the orchestrator stamps `time_box_started_at` and
schedules a `setTimeout` that calls
`runState.abortController.abort('TIMEOUT')` on expiry. The post-exit
pipeline (§5.2 stage A) checks `runState.abortReason` and short-circuits
to `BLOCKED (TIMEOUT)` — the question file is explicitly NOT trusted in
this case because the agent was killed mid-thought. The human can then
extend (`extendTimeBox` — transitions back to QUEUED with the box
increased) or kill (`killTask` → FAILED). A race where the timer fires
just as the agent exits naturally is resolved in favor of the natural
exit — abort reason is checked *after* the exit code is known.

**Subtask spawning** runs through the same scheduler. Agents write a YAML
manifest to `$HIVEBOARD_SUBTASKS`; the post-exit pipeline's stage D
parses, validates (cap 20 per manifest; tags must exist on the board;
`depends_on_siblings` indices in-range), and materializes children as
new tasks with the parent's `parent_task_id` and inherited
board/repo/branch. Sibling dependencies become `task_dependencies` rows
so the same dep-aware SELECT orders them correctly. Children get a
fresh scratchpad — agents coordinate only through task state, never
through shared agent memory.

---

## 12. Database ER Diagram

20 tables. Existing shape preserved; new tables grouped by feature area.

```
                          ┌───────────────┐
                          │    users      │
                          └───────┬───────┘
                                  │ 1
                                  ├────────── boards ───── columns ──┐
                                  │                                   │
                                  │                                   ▼
                                  │                             ┌──────────┐
                                  │                             │  tasks   │◄─────────┐
                                  │                             └────┬─────┘          │
                                  │                                  │ 1              │
                ┌─────────────────┼──────────────────────┬───────────┴──────┬──────┐  │
                ▼ N               ▼ N                    ▼ N                ▼ N    ▼ N│
           task_comments    task_events         agent_runs            task_messages  │
                                                      │                               │
                                                      │ 1                             │
                                                      ▼ N                             │
                                     agent_run_checkpoints (Spec G)                   │
                                                                                      │
   board_secrets ◀─ boards                                                            │
   task_secrets  ◀─ tasks                              task_dependencies ────(self-join)
   task_tags / tags    (existing)                                                     │
   verification_runs (Spec C)  ──── tasks                                             │
   workspace_snapshots (Spec D) ─── tasks                                             │
   playbooks / playbook_versions (Spec F) ── (agent_runs.playbook_version_id)         │
```

**New tables (orchestration wave):**

| Table | Spec | Notes |
|-------|------|-------|
| `task_messages` | B | `kind ∈ {hint, redirect, question, answer}`, `delivered_at` drives injection |
| `verification_runs` | C | one row per command per batch; `output` capped at last 200 lines |
| `workspace_snapshots` | D | `patch` is gzip-compressed `git diff HEAD`; fetched lazily via `workspaceSnapshotPatch` query |
| `task_dependencies` | E | `(task_id, blocker_id)` many-to-many; cascades on either side delete |
| `playbooks`, `playbook_versions` | F | immutable versions; `playbook_versions.allowed_tools_override` clamps agent tools per run |
| `agent_run_checkpoints` | G | one row per agent turn; summary capped at 2 KB |
| `board_secrets`, `task_secrets` | H | `encrypted_value` BLOB = nonce ‖ ciphertext ‖ tag; plaintext never surfaces |

**New columns on `tasks`:**

| Column | Spec |
|--------|------|
| `verify_attempt_count`, `verify_commands`, `pending_auto_revise_source_run_id` | C |
| `parent_task_id`, `time_box_ms`, `time_box_started_at`, `block_reason` | E |
| `required_secrets` (JSON array of names) | H |

**New column on `agent_runs`:** `playbook_version_id` (F).

Indexes follow the access patterns — partial index on
`task_messages(task_id, delivered_at) WHERE delivered_at IS NULL` for the
undelivered-scan on every spawn; `idx_checkpoints_run(agent_run_id, turn)`
for ordered replay reads; `idx_workspace_snapshots_task(task_id,
captured_at)` for the diff scrubber.

**Key constraints:**

- All IDs are `TEXT` (ULIDs generated at insert time).
- `boards`, `tasks`, and per-task children (comments, events, messages,
  checkpoints, verification runs, workspace snapshots, task secrets,
  dependencies in both directions) cascade-delete via `ON DELETE CASCADE`.
- `columns` cascade-delete when their parent board is deleted.
- All timestamps are ISO 8601 strings via `datetime('now')`.

---

## 13. Position Strategy

Task ordering within a column uses a **REAL-valued position** with a gap of
**1024** between items.

| Operation | Position calculation |
|-----------|-------------------|
| New task (append) | `max(position) + 1024`, or `0` if column is empty |
| Drop at top | `firstTask.position - 1024` |
| Drop between two tasks | `(prev.position + next.position) / 2` (fractional midpoint) |
| Drop at bottom | `lastTask.position + 1024` |

Large gap avoids rewriting every row on reorder; approximately 10 levels
of bisection are possible before a rebalance becomes desirable. Column
`position` is `INTEGER` (simple ordinal); task `position` is `REAL` to
support fractional inserts.

---

## 14. Auth Model

HiveBoard has two access modes. Which one applies is decided per-request by
`getAuthContext` (`packages/api/src/auth/context.ts`).

### 14.1 Local mode (auto-admin)

When the API is reached from localhost or a Docker-internal network, the
caller is auto-authenticated as the seed user **`queen-bee`**
(role `super-admin`). This is what makes `bun run dev` Just Work — no
login flow for the single-user case.

Trust is decided **exclusively from the socket peer address** returned by
`server.requestIP(request)` in the top-level `Bun.serve` fetch handler.
That IP is propagated into auth via a `WeakMap` in
`packages/api/src/auth/peer-ip.ts`. Client-supplied headers
(`X-Forwarded-For`, `X-Real-IP`, `Host`) are **never** consulted —
trusting them would let any remote attacker spoof localhost and take over
the queen-bee account.

Networks considered local:

- `127.0.0.0/8`, `::1`, `::ffff:127.0.0.1`
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (Docker-internal)

If you put HiveBoard behind a reverse proxy that terminates TLS and
forwards to HiveBoard over loopback, the proxy's peer IP *is* localhost —
auto-admin will trigger. Don't expose the API behind such a proxy unless
you also gate access at the proxy.

### 14.2 Remote mode (GitHub OAuth + invitations)

When the peer is not local, callers must authenticate.

- **Invitations.** A super-admin (e.g. queen-bee via local mode) issues a
  one-time invitation bound to a specific `github_username`
  (`generateInvitation` mutation). The token expires after 7 days.
- **OAuth sign-in.** The browser hits `GET /api/auth/github/start`, which
  returns a random `state` nonce and sets an HMAC-signed, HttpOnly,
  `SameSite=Lax` cookie holding `{ state, invitationToken, issuedAt }`. The
  browser then redirects to GitHub with that `state`.
- **Callback.** GitHub redirects to `/auth/callback?code=…&state=…`; the
  web client POSTs `{ code, state }` (with `credentials: 'include'`) to
  `/api/auth/github/callback`. The server verifies the cookie signature,
  timing-safe-compares the `state`, exchanges the code, and — for
  invitations — checks that the GitHub login matches the invited username
  before creating the user and a session.
- **Sessions.** 32-byte random tokens
  (`packages/api/src/auth/session.ts`), 24-hour TTL, sent by the client
  as `Authorization: Bearer <token>` on every GraphQL request. Revoking a
  user deletes their sessions (`revokeUser` calls
  `revokeSessionsForUser`).

`SESSION_SECRET` must be set whenever OAuth is enabled — it signs the OAuth
state cookie. `CORS_ALLOWED_ORIGINS` must be set in production or the API
refuses to start; it is an explicit allowlist (no origin reflection).

### 14.3 Authorization (ownership)

Beyond authentication, every board-scoped operation checks ownership.
Helpers live at the top of `packages/api/src/schema/resolvers.ts`
(`requireBoardAccess`, `requireTaskAccess`, `requireCommentAccess`,
`requireTagAccess`). Super-admins bypass every check; non-super-admin
users can only read or mutate resources on boards they own. Missing and
unauthorized-but-exists cases both raise the same `NOT_FOUND` error.
`moveTask` additionally verifies the target column belongs to the same
board; `setTaskTags` verifies every tag belongs to the task's board.
Dependency edges are rejected across boards (`DEPENDENCY_CROSS_BOARD`).

### 14.4 Threat-model limits

HiveBoard still spawns `claude` with `--permission-mode bypassPermissions`.
Any authenticated user who *owns* a board can cause the server to run
agents on any repo their `targetRepo` field points at, using the server's
own credentials. Invite only people you'd let `ssh` into the box.

Two operational guardrails the orchestrator wave added:

- **GitHub token is denied to the agent subprocess.** `GITHUB_TOKEN` /
  `GH_TOKEN` / `GITHUB_APP_*` are in `DENIED_ENV_VARS` in
  `packages/api/src/agent/env.ts`. Git and `gh` inside the workspace
  use on-disk token files the orchestrator refreshes each poll.
- **Per-task secrets are only injected for runs of tasks that declare
  them.** The pre-spawn pipeline is the single point where ciphertext
  becomes plaintext.

Boards are still created only by super-admins; there is no
`board_members` table. Multi-user collaboration on a single shared board
is not supported — each invited user effectively gets their own workspace
unless promoted to super-admin.

---

## 15. Configuration System

Configuration comes from two sources.

### 15.1 WORKFLOW.md (agent config + prompt template)

`WORKFLOW.md` uses **YAML front matter** (delimited by `---`) parsed by the
`yaml` library and validated with a Zod schema (`ConfigSchema`).
Everything below the closing `---` is the **prompt template** sent to
Claude CLI; Mustache `{{ variable }}` interpolation plus shared partials
(§7).

```yaml
---
polling:
  interval_ms: 30000
workspace:
  root: ./tmp/workspaces
  ttl_ms: 259200000        # 72h stale workspace cleanup
agent:
  max_concurrent_agents: 5
  max_retry_backoff_ms: 300000
  state_root: ./tmp/agent-state   # per-task agent-state dir root (Specs A/B/D/E)
claude:
  command: claude
  model: opus
  max_turns: 200
  permission_mode: bypassPermissions
  allowed_tools: [Bash, Read, Write, Edit, Glob, Grep]
verify:
  enabled: true
  max_auto_revises: 1
  commands:
    - { label: lint, run: bun run lint, timeout_ms: 120000 }
    - { label: tsc,  run: bun run tsc,  timeout_ms: 180000 }
    - { label: test, run: bun run test, timeout_ms: 300000 }
progress:
  enabled: true
  snapshot_interval_ms: 15000
  snapshot_disk_budget_mb: 10
scheduler:
  legacy_mode: false
hooks:
  after_create: >-
    git clone --depth 1 ... && git checkout -b task-{{ task.short_id }}/{{ task.slug }}
---
(prompt template follows; references {{> scratchpad}} {{> messages}} etc.)
```

**Config sections:**

| Section | Key fields | Defaults |
|---------|-----------|----------|
| `polling` | `interval_ms` | 5000 |
| `workspace` | `root`, `ttl_ms` | `./workspaces`, 72 h |
| `agent` | `max_concurrent_agents`, `max_retry_backoff_ms`, `state_root` | 5, 300000, `./tmp/agent-state` |
| `claude` | `command`, `model`, `max_turns`, `allowed_tools`, `permission_mode` | `claude`, -, 50, -, - |
| `verify` | `enabled`, `max_auto_revises`, `commands[]` | `true`, 1, `[]` |
| `progress` | `enabled`, `snapshot_interval_ms`, `snapshot_disk_budget_mb` | `true`, 15000, 10 |
| `scheduler` | `legacy_mode` | `false` |
| `hooks` | `after_create`, `before_run`, `after_run`, `before_remove`, `timeout_ms` | -, -, -, -, 60000 |

Environment variable references (`$ENV_VAR`) in string values are
resolved at parse time. The orchestrator starts best-effort: if
`WORKFLOW.md` is missing or invalid, the API server still runs (you just
cannot dispatch agents).

### 15.2 .env (secrets and ports)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `GITHUB_TOKEN` | Yes* | - | Personal access token (`repo` scope) |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_APP_INSTALLATION_ID` | Alt* | - | GitHub App auth |
| `HIVEBOARD_SECRETS_KEY` | Recommended | - | base64(32 B); enables per-task secrets (§10). Absent → feature disabled, tasks declaring `required_secrets` hold in `MISSING_SECRETS`. |
| `SESSION_SECRET` | Yes (if OAuth) | - | Signs OAuth state cookie |
| `CORS_ALLOWED_ORIGINS` | Yes (prod) | - | Explicit allowlist |
| `API_PORT` | No | `8080` | API server port |
| `WEB_PORT` | No | `5173` | Vite dev server port |
| `DATABASE_PATH` | No | `tmp/database/hiveboard.db` | SQLite file location |

*Either `GITHUB_TOKEN` or the three `GITHUB_APP_*` variables must be set.

---

## 16. GraphQL API Surface

The API surface grew substantially with the orchestration wave. High-level
groupings:

- **Tasks** — `board`, `boards`, `task`, `createTask`, `updateTask`,
  `moveTask`, `archiveTask`, `unarchiveTask`
- **Agent dispatch** — `runAgent` (accepts `"plan" | "implement" | "revise"
  | "playbook:<name>"`), `cancelAgent`, `continueFailedTask`,
  `killTask`, `extendTimeBox`, `setTimeBox`
- **Observability (per-task)** — `agentRuns`, `taskTimeline`,
  `workspaceSnapshot`, `workspaceSnapshotPatch`, `taskProgress`
- **Messages** — `sendHint`, `sendRedirect`, `answerQuestion`;
  `Task.messages`, `Task.currentQuestion`
- **Scratchpad** — `Task.scratchpad`
- **Verification** — `Task.verificationRuns`, `Task.verifyAttemptCount`,
  `setTaskVerifyCommands`
- **Dependencies / subtasks** — `Task.blockers`, `Task.dependents`,
  `Task.parentTask`, `Task.subtasks`; `addTaskDependency`,
  `removeTaskDependency`
- **Playbooks** — `playbooks`, `playbook`; `createPlaybook`,
  `updatePlaybook`, `archivePlaybook`, `unarchivePlaybook`
- **Secrets** — `Board.secrets`, `Task.taskSecrets`, `Task.missingSecrets`,
  `Task.requiredSecrets`; `setBoardSecret`, `deleteBoardSecret`,
  `setTaskSecret`, `deleteTaskSecret`, `setTaskRequiredSecrets` (values
  never returned; only names + metadata)
- **Comments / tags** — `addComment`, `updateComment`, `deleteComment`,
  `createTag`, `deleteTag`, `setTaskTags`
- **Auth** — `me`, `generateInvitation`, `revokeUser`

**Subscriptions (SSE):** `taskUpdated`, `agentLogStream`, `commentAdded`,
`commentUpdated`, `taskEventAdded`, `scratchpadUpdated`, `messageAdded`,
`taskProgressAdded`, `workspaceSnapshotAdded`, `verificationRunAdded`,
`agentCheckpointAdded`, `taskMissingSecretsChanged`.

The endpoint is `POST /graphql` for queries and mutations, and
`GET /graphql?query=subscription{...}` for SSE subscriptions. A `/health`
endpoint returns `{ ok: true, uptime: N }`.

In production mode (`NODE_ENV=production`), the API also serves the built
web frontend from `packages/web/dist/` with SPA fallback.

---

## Cross-References

- [maintainer-guide.md](./maintainer-guide.md) — Operational procedures,
  deployment, and troubleshooting.
- [conventions.md](./conventions.md) — Code style, naming, component
  patterns.
- [api-reference.md](./api-reference.md) — Full GraphQL schema
  documentation.
