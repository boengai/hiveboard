# HiveBoard — Domain Language

This file captures domain terms with load-bearing meanings. If you find
yourself using one of these words, use it as defined here.

For architectural vocabulary (Module / Interface / Seam / Adapter /
Depth / Locality / Leverage / deletion test), see
`~/.claude/skills/improve-codebase-architecture/LANGUAGE.md`.

For the runtime shape these terms describe, see `docs/architecture.md`.

---

## Task Lifecycle

The state machine governing `tasks.agent_status`. Documented in
`docs/architecture.md` §4. Implemented as a single module with one
entrypoint:

```
transition({ taskId, to, blockReason?, event: { type, actor, data } }, force?)
```

Owns, atomically:

1. Update of `tasks.agent_status` (and `block_reason` when relevant).
2. Insert into `task_events`.
3. Publish on `TASK_UPDATED` (and `TASK_EVENT` when an event row is written).

Does **not** own `agent_runs.status` writes — those stay with the caller
because not every transition has a run (e.g. dependency-cascade BLOCKED).

Strict: rejects edges not declared in the §4 diagram. `force: true` is
the migration / one-off escape hatch and must carry a comment explaining
why.

The Task Lifecycle is the only place `agent_status` is written outside
of seed migrations. New transition kinds extend the machine; no resolver
or orchestrator branch writes the column directly.

## Outcome

The post-exit pipeline (`docs/architecture.md` §5.2) treats every agent
process exit as resolving to exactly one Outcome. Outcomes are:

- `Timeout` — abort reason was `TIMEOUT`.
- `Question` — agent wrote `$HIVEBOARD_QUESTION` and exited.
- `VerificationFailure` — `verifyAndGate` returned `'fail'` on a
  parent task.
- `Success` — natural success; runs subtasks → verify gate →
  finalize-success (PR parsing + column move + dependent republish).
- `Failure` — natural failure; cascades dependencies.

The picker (`decideOutcome`) is pure: given run state + result + side
files, returns the discriminated Outcome. The §5.2 priority order
("question wins over verify, timeout wins over question") lives in the
picker — once, expressed as code.

Each Outcome has a single `apply(deps)` entrypoint that goes through the
Task Lifecycle for its status transition. Outcomes never write
`agent_status` directly.

## Pre-spawn / Post-exit Pipeline

The two ordered chains documented in `docs/architecture.md` §5. The
post-exit pipeline is the dispatch surface for Outcomes.

The Pre-spawn Pipeline lives in `packages/api/src/orchestrator/prespawn/`.
Single entrypoint:

```
plan(task, deps) → { kind: 'ok', plan: SpawnPlan }
                 | { kind: 'missing_secrets', missing: string[] }
```

`plan()` is pure-ish: DB reads, secrets decryption, and a single GitHub
read (PR review comments on `revise` actions). It performs **no DB
writes** — the writes it implies (`delivered_at`, clearing
`pending_auto_revise_source_run_id`) are returned as a typed
`SpawnPlanCommits` struct that the orchestrator lands inside the same
`taskLifecycleTransition` that moves the task to `RUNNING`. Workspace
creation, time-box arming, and `runAgent` invocation stay with the
orchestrator.

The secrets gate runs first. A `MissingSecrets` result transitions
`queued → missing_secrets` with no workspace I/O and no orphan
`agent_run`. The `running → missing_secrets` edge does not exist.
