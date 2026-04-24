# Changelog

All notable user-facing changes to HiveBoard.

This project uses [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/).

## [Unreleased]

This release is the "agent orchestration" wave — eight coordinated features
turning HiveBoard from a Kanban-with-agents shell into a real orchestration
surface where agents have persistent memory, can ask questions, and run under
dependency, time, and secrets constraints.

### Added

- **Agent scratchpad — cross-run persistent memory.** Each task gets a
  markdown scratchpad at `tmp/agent-state/{task-id}/scratchpad.md`. The
  orchestrator eager-injects it into every agent prompt; the agent appends
  notes via `>>` so PLAN → IMPLEMENT → REVISE runs share context without
  rediscovering the codebase. New `Task.scratchpad` GraphQL field +
  `scratchpadUpdated` subscription; read-only panel in the task drawer.
  (`af822f5`)
- **Bidirectional agent ↔ human channel.** Agents can pause the task in a
  new `BLOCKED` state by writing to `$HIVEBOARD_QUESTION` and exiting.
  Humans can send `hint` (non-urgent, agent polls `$HIVEBOARD_INBOX`),
  `redirect` (aborts the running agent and requeues), or `answer`
  (auto-resumes the task with a 30-second grace window). New
  `task_messages` table; chat-style "Messages" panel in the drawer.
  (`0b10bf1`)
- **Self-verify loop.** After a successful IMPLEMENT/REVISE, the
  orchestrator runs the project's verification commands (lint, tsc, test)
  declared in `WORKFLOW.md`. On red, auto-dispatches a REVISE with the
  failure output injected into the prompt. Bounded by
  `verify.max_auto_revises` (default 1). Humans only see FAILED tasks
  when the agent genuinely couldn't recover. (`ebfabaf`)
- **Progress visibility.** Two tracker-side surfaces: structured progress
  pings (agent writes NDJSON to `$HIVEBOARD_PROGRESS`, renders as a step
  list with status icons) and a scrubbable diff timeline (orchestrator
  snapshots `git diff` every 15s during RUNNING). New `workspace_snapshots`
  table; renamed existing `TaskTimeline.tsx` → `TaskEventHistory.tsx` to
  free the name for the new diff scrubber. (`eb449f4`)
- **Orchestration upgrades.** Three scheduler-level features on shared
  plumbing: **dependency graph** (`blockedBy`, cycle detection, auto-
  unblock on blocker SUCCESS, cascade to `DEPENDENCY_FAILED` on blocker
  FAILED); **agent-spawned subtasks** (agent writes a YAML manifest to
  `$HIVEBOARD_SUBTASKS`; orchestrator creates up to 20 children on exit);
  **time-boxing** (`time_box_ms` per task; expiry → BLOCKED with
  `block_reason='TIMEOUT'`, `extendTimeBox` + `killTask` mutations).
  Adds `block_reason` column distinguishing BLOCKED sources
  (`QUESTION`/`TIMEOUT`/`DEPENDENCY_FAILED`). (`48d998a`)
- **Playbooks — reusable, versioned task recipes.** Named bundles of
  `{prompt_template, defaults, allowed_tools_override}` stored in
  SQLite. Immutable versions; editing creates a new version; tasks record
  which version ran. Dispatch `action: "playbook:<name>"`. Ships with
  four seeded playbooks: `bump-dep`, `add-tests`, `triage-flake`,
  `security-review`. New `/playbooks` page with browser + editor.
  WORKFLOW.md's prompt blocks extracted into shared Mustache partials
  under `packages/api/src/agent/prompt-partials/`. (`e246407`)
- **Checkpoint / resume — turn-level replay on retry.** Switches the
  Claude CLI invocation to `--output-format stream-json` (capability-
  gated at boot — feature auto-disables on older CLIs). New
  `agent_run_checkpoints` table captures one compact summary per turn.
  On retry (`retry_count > 0`), the orchestrator injects a bounded
  replay of the prior attempt into the new prompt (last 20 turns + every
  error + sampled tool uses, capped at 50 entries). New
  `continueFailedTask` mutation for a one-click manual continue from a
  FAILED state. `AgentRunLog` component renders the structured trace.
  (`eaf87e2`)
- **Per-task secrets — encrypted env injection.** New `board_secrets` and
  `task_secrets` tables store AES-256-GCM ciphertext; decryption key
  derived from a new required env var `HIVEBOARD_SECRETS_KEY` (HKDF-
  SHA256, `openssl rand -base64 32`). Tasks declare `required_secrets`
  (JSON array of `UPPER_SNAKE` names); orchestrator resolves task
  override → board default → missing, refusing to spawn and transitioning
  the task to `MISSING_SECRETS` if any are absent. Setting a missing
  secret auto-unblocks dependent tasks with a 5-second grace window.
  Agent subprocess receives decrypted values under their declared names
  (not under `HIVEBOARD_*`). Captured `agent_runs.output` is scrubbed
  via literal-match replacement (`[redacted:NAME]`) as defense-in-depth.
  GraphQL never surfaces plaintext or ciphertext — only names and
  metadata. (`63607c7`)

### Changed

- **GraphQL `BoardAction` enum replaced with a `String`** to accommodate
  playbook dispatch values (`"playbook:<name>"`). Callers using the enum
  directly need to update to the string form. Built-in values remain
  `"plan"` / `"implement"` / `"revise"`. (Spec F, `e246407`)
- **Agent prompt template structure.** The action-specific blocks in
  `WORKFLOW.md` now reference shared Mustache partials
  (`scratchpad`, `messages`, `question`, `progress`, `subtasks`) so both
  built-in actions and playbook prompts stay in sync. Rendered output is
  byte-identical to the prior release for built-in actions; no behavior
  change intended for existing installs. (Spec F)

### Security

- **Encrypted per-task secrets** (see Added → Per-task secrets). New
  required env var `HIVEBOARD_SECRETS_KEY`; if absent, the feature is
  inert and tasks with declared `required_secrets` are held in
  `MISSING_SECRETS` rather than leaking through. See `.env.example` for
  generation instructions.

### Fixed

- macOS test suite is fully green again: `path-safety.test.ts` now
  canonicalizes `os.tmpdir()` paths to handle the `/var` ↔ `/private/var`
  symlink on macOS, eliminating the five long-standing environment-
  dependent failures. (`3729abc`)

### Upgrade notes

- **Set `HIVEBOARD_SECRETS_KEY` before upgrading** if you plan to use the
  per-task secrets feature. Generate with `openssl rand -base64 32` and
  add to `.env`. Without it, the feature is disabled but does not break
  existing tasks (only new tasks declaring `required_secrets` will be
  held in `MISSING_SECRETS`).
- **External GraphQL consumers** that relied on the `BoardAction` enum
  should update to the string form (`"plan"`, `"implement"`, `"revise"`,
  or `"playbook:<name>"`).
- **On-disk layout:** per-task agent files now live under
  `tmp/agent-state/{task-id}/` (configurable via `agent.state_root` in
  `WORKFLOW.md`). Scratchpads, inbox/question files (Spec B), progress
  logs (Spec D), and subtask manifests (Spec E) all share this directory.
  Existing `tmp/workspaces/` is unchanged.
- **DB migrations** add seven new tables and eight new columns. Migrations
  are backward-compatible; no existing data is modified beyond a one-time
  backfill of `tasks.block_reason = 'QUESTION'` for any task currently
  in the `BLOCKED` state.

## [0.2.19] and earlier

See `git log --oneline v0.1.0..v0.2.19` for the pre-orchestration-wave
history. Notable pre-existing items include GitHub OAuth, invitation
flow, local vs remote mode detection, PR review → REVISE loop, and the
initial set of security hardening patches.
