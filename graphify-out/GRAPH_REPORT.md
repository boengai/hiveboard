# Graph Report - .  (2026-05-08)

## Corpus Check
- 348 files · ~160,851 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1344 nodes · 2002 edges · 184 communities (173 shown, 11 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 179 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]

## God Nodes (most connected - your core abstractions)
1. `generateId()` - 63 edges
2. `createTables()` - 60 edges
3. `getCurrentUser()` - 27 edges
4. `seed()` - 27 edges
5. `HiveBoard GraphQL API Skill` - 25 edges
6. `Orchestrator` - 22 edges
7. `5. Types` - 21 edges
8. `agentStateDir()` - 18 edges
9. `Architecture` - 18 edges
10. `Maintainer Guide` - 16 edges

## Surprising Connections (you probably didn't know these)
- `getCurrentUser()` --calls--> `insertTask()`  [INFERRED]
  packages/api/test/helpers/fixtures.ts → test/resolvers.test.ts
- `insertQueuedTask()` --calls--> `generateId()`  [INFERRED]
  packages/api/test/orchestrator-blocked.test.ts → packages/api/src/db/ulid.ts
- `insertQueuedTaskWithAction()` --calls--> `generateId()`  [INFERRED]
  packages/api/test/orchestrator-maptask.test.ts → packages/api/src/db/ulid.ts
- `setup()` --calls--> `createTables()`  [INFERRED]
  packages/api/test/workspace-snapshots-db.test.ts → packages/api/src/db/schema.ts
- `insertTask()` --calls--> `generateId()`  [INFERRED]
  packages/api/test/orchestrator-dispatch.test.ts → packages/api/src/db/ulid.ts

## Communities (184 total, 11 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (29): checkpointsSupported(), buildPromptContext(), renderPrompt(), buildClaudeArgs(), buildScrubPairs(), runAgent(), loadWorkflow(), splitFrontMatter() (+21 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (20): IllegalLifecycleEdgeError, isAllowedEdge(), isValidStatus(), mapTaskRow(), transition(), findColumnId(), findColumnName(), extractPlanFromOutput() (+12 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (20): getCurrentQuestion(), listMessagesForTask(), mapMessageRow(), listVerificationRunsForTask(), getTaskById(), getUserById(), mapPlaybook(), mapPlaybookVersion() (+12 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (48): Agent Messages (Spec B), Agent Runs (History), Archive / Unarchive, Cancel a Running Agent, code:graphql (query {), code:graphql (mutation ArchiveTask($id: ID!) {), code:graphql (query Tags($boardId: ID!) { tags(boardId: $boardId) { id nam), code:graphql (query Comments($taskId: ID!) {) (+40 more)

### Community 4 - "Community 4"
Cohesion: 0.04
Nodes (48): 1. Endpoint Info, 2. Queries, 4. Subscriptions, 6. Enums, 7. Input Types, 8. Error Codes, 9. PubSub Channels (Internal Reference), `agentRuns(taskId: ID!): [AgentRun!]!` (+40 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (45): 1. Naming Conventions, 2. Biome Configuration, 3. File Structure, 4. Styling, 5. Commit Messages, 6. GraphQL, 7. Database, 8. Runtime Singletons & Agent State (+37 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (17): cascadeDependencyFailure(), wouldCreateCycle(), Orchestrator, getOrchestrator(), setOrchestrator(), applyFailure(), applyTimeout(), decideOutcome() (+9 more)

### Community 7 - "Community 7"
Cohesion: 0.04
Nodes (45): 3. Mutations, `addComment(taskId: ID!, body: String!, parentId: ID): Comment!`, `addTaskDependency(taskId: ID!, blockerId: ID!): Task!`, Agent dispatch & control, `answerQuestion(taskId: ID!, body: String!): TaskMessage!`, `archivePlaybook(id: ID!): Playbook!` / `unarchivePlaybook(id: ID!): Playbook!`, `archiveTask(id: ID!): Task!`, Bidirectional channel (Spec B) (+37 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (41): 5. Types, `AgentLogChunk`, `AgentRun`, `AgentRunCheckpoint` (Spec G), `AuthConfig`, `Board`, `BoardSecret` & `TaskSecret` (Spec H), code:graphql (type User {) (+33 more)

### Community 9 - "Community 9"
Cohesion: 0.12
Nodes (26): getBoard(), getColumn(), getCurrentUser(), insertTask(), makeCtx(), getEventsForTask(), insertTask(), getBoard() (+18 more)

### Community 10 - "Community 10"
Cohesion: 0.14
Nodes (22): buildAgentEnv(), getConfig(), setConfig(), dispatchHumanMessage(), applyQuestion(), getScratchpad(), readProgressEntries(), agentStateDir() (+14 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (8): buildClaudeArgsForTest(), flushMicrotasks(), makeConfig(), makeGitHubStub(), makeWorkspaceStub(), insertQueuedTask(), insertTask(), insertQueuedTaskWithAction()

### Community 12 - "Community 12"
Cohesion: 0.05
Nodes (36): 10. Secrets: Encryption and Scrubbing, 11. Scheduling: Dependencies + Time-Boxing, 12. Database ER Diagram, 13. Position Strategy, 14.1 Local mode (auto-admin), 14.2 Remote mode (GitHub OAuth + invitations), 14.3 Authorization (ownership), 14.4 Threat-model limits (+28 more)

### Community 13 - "Community 13"
Cohesion: 0.1
Nodes (17): buildPreviousAttemptReplay(), isWriteOrEdit(), selectCheckpointsForReplay(), NDJSONLineParser, capRow(), firstBlockOfType(), firstTextBlock(), summarizeAssistant() (+9 more)

### Community 14 - "Community 14"
Cohesion: 0.06
Nodes (32): Actions, Architecture, Authentication, Available Commands, Build from source, code:block1 (┌──────────────────────────────────────────────────────┐), code:block2 (hiveboard/), code:bash (git clone https://github.com/boengai/hiveboard.git) (+24 more)

### Community 15 - "Community 15"
Cohesion: 0.1
Nodes (17): escapeMustacheSyntax(), formatScratchpadSummary(), formatVerificationFailureForAgent(), resolveCommands(), runVerificationCommand(), sanitizedEnv(), tailLines(), verifyAndGate() (+9 more)

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (13): Avatar(), useTaskSubscription(), CollapsibleSection(), handleContinueTask(), handleCreateTag(), readSectionMap(), refetchBoard(), useSectionOpen() (+5 more)

### Community 17 - "Community 17"
Cohesion: 0.13
Nodes (11): addDependencyEdge(), listBlockers(), listDependents(), removeDependencyEdge(), unresolvedBlockerCount(), selectSchedulableTasks(), createSubtasksFromManifest(), parseSubtasksManifest() (+3 more)

### Community 18 - "Community 18"
Cohesion: 0.11
Nodes (11): seed(), seedPlaybooks(), generateId(), seedTask(), insertRunningAgentRun(), insertTask(), insertHintMessage(), insertQueuedTaskWithAction() (+3 more)

### Community 19 - "Community 19"
Cohesion: 0.09
Nodes (8): eventDescription(), parseData(), timeAgo(), handleSubmit(), reset(), sendAnswer(), sendHint(), sendRedirect()

### Community 20 - "Community 20"
Cohesion: 0.12
Nodes (17): getLastStatHashForTask(), getSnapshotById(), getSnapshotPatch(), insertSnapshot(), listSnapshotsForTask(), mapListRow(), sumPatchBytesForTask(), ConnectionStateManager (+9 more)

### Community 21 - "Community 21"
Cohesion: 0.12
Nodes (7): addColumnIfMissing(), createTables(), mergePlaybookDefaultsIntoTask(), parseDefaults(), setup(), setup(), seedDb()

### Community 22 - "Community 22"
Cohesion: 0.17
Nodes (12): getKek(), initSecretsFromEnv(), secretsEnabled(), decrypt(), deriveKek(), encrypt(), computeMissingSecretNames(), parseRequiredSecrets() (+4 more)

### Community 23 - "Community 23"
Cohesion: 0.15
Nodes (4): getClientIp(), RateLimiter, useMutationRateLimit(), createTestYoga()

### Community 24 - "Community 24"
Cohesion: 0.18
Nodes (7): detectCheckpointSupport(), _setCheckpointSupportForTest(), startOrchestrator(), sweepOrphanAgentStateDirs(), cleanupTempUploads(), runCleanupTick(), startCleanupInterval()

### Community 25 - "Community 25"
Cohesion: 0.12
Nodes (15): Capability Gating (Spec G), CI order, CI Scripts, code:bash (claude --help | grep stream-json     # should print a line; ), code:bash (bun install), code:ts (process.on('SIGTERM', async () => {), Cross-References, Feature Flags and Escape Hatches (+7 more)

### Community 26 - "Community 26"
Cohesion: 0.22
Nodes (10): consumeInvitation(), createInvitation(), generateInvitationToken(), validateInvitation(), exchangeCodeForUser(), handleInvitationOAuth(), handleLoginOAuth(), cleanExpiredSessions() (+2 more)

### Community 27 - "Community 27"
Cohesion: 0.22
Nodes (7): cleanupUnusedImages(), handleImageServe(), handleImageUpload(), isValidPathSegment(), getUploadDir(), resolvePathSafe(), validateWorkspacePath()

### Community 28 - "Community 28"
Cohesion: 0.21
Nodes (6): getBoard(), getColumn(), getUser(), insertAgentRun(), insertTask(), runScenario()

### Community 29 - "Community 29"
Cohesion: 0.27
Nodes (10): addMissingColumns(), ensureColumn(), migrate(), normalizeLegacyVerifyCommands(), renameColumn(), getBoard(), getColumn(), getTaskRow() (+2 more)

### Community 30 - "Community 30"
Cohesion: 0.29
Nodes (10): getAuthContext(), mapUserRow(), requireAuth(), requireSuperAdmin(), isDockerNetwork(), isLocalOrDockerHost(), isLocalRequest(), normalizeIp() (+2 more)

### Community 32 - "Community 32"
Cohesion: 0.36
Nodes (9): buildOAuthStateCookie(), clearOAuthStateCookieHeader(), generateOAuthState(), getSecret(), hmac(), randomHex(), readOAuthStateCookie(), timingSafeEqual() (+1 more)

### Community 33 - "Community 33"
Cohesion: 0.27
Nodes (8): addComment(), CommentDepthError, CommentNotFoundError, deleteComment(), fetchTaskEventForPublish(), mapCommentRow(), publishTaskEventRow(), updateComment()

### Community 34 - "Community 34"
Cohesion: 0.42
Nodes (5): setPeerIP(), handleOAuthCallback(), handleOAuthStart(), createApiYoga(), fetch()

### Community 35 - "Community 35"
Cohesion: 0.2
Nodes (9): Action: implement, Action: plan, Action: revise, code:block1 ({{ output }}), {{ label }} — exit {{ exit_code }}, Previous attempt replay, Review Comments to Address, Secrets available for this task (+1 more)

### Community 37 - "Community 37"
Cohesion: 0.22
Nodes (8): [0.2.19] and earlier, Added, Changed, Changelog, Fixed, Security, [Unreleased], Upgrade notes

### Community 38 - "Community 38"
Cohesion: 0.22
Nodes (9): "Agent timed out but didn't BLOCK", "Auto-REVISE loop exhausted", "Checkpoint replay missing for a retry", code:bash (printenv HIVEBOARD_SECRETS_KEY | head -c 8), code:graphql (query { task(id: "...") { missingSecrets requiredSecrets } }), code:sql (SELECT COUNT(*) FROM agent_run_checkpoints), Operational Runbooks, "Playbook version history grew large" (+1 more)

### Community 39 - "Community 39"
Cohesion: 0.22
Nodes (9): `agent.*` (Spec A), code:yaml (agent:), code:yaml (verify:), code:yaml (progress:), code:yaml (scheduler:), Config Reference (WORKFLOW.md front matter), `progress.*` (Spec D), `scheduler.*` (Spec E) (+1 more)

### Community 40 - "Community 40"
Cohesion: 0.22
Nodes (9): 1. Add a DB column, code:ts (// packages/api/src/db/schema.ts), code:ts (// packages/api/src/db/schema.ts), code:sql (UPDATE tasks SET block_reason = 'QUESTION'), code:graphql (type Task {), Step 1 --- Add to `schema.ts`, Step 2 --- Add idempotent migration, Step 3 --- Expose in GraphQL schema (+1 more)

### Community 41 - "Community 41"
Cohesion: 0.25
Nodes (8): 2. Add a GraphQL mutation, 3. Add a subscription, 4. Add a config field, 5. Add an agent action, 6. Add a web component, 7. Swap agent runtime, code:ts (Mutation: {), How-To Recipes

### Community 42 - "Community 42"
Cohesion: 0.25
Nodes (8): code:ts (export const db = new Database(dbPath)), Database Notes, Migration approach, Schema changes introduced by Specs A-H, Seeded data, SQLite WAL mode, Task positions, ULID generation

### Community 44 - "Community 44"
Cohesion: 0.29
Nodes (6): code:block1 (transition({ taskId, to, blockReason?, event: { type, actor,), code:block2 (plan(task, deps) → { kind: 'ok', plan: SpawnPlan }), HiveBoard — Domain Language, Outcome, Pre-spawn / Post-exit Pipeline, Task Lifecycle

### Community 46 - "Community 46"
Cohesion: 0.6
Nodes (3): handleCreate(), handleKeyDown(), selectOption()

### Community 48 - "Community 48"
Cohesion: 0.4
Nodes (5): code:bash (bun test                                       # all), Conventions, macOS test suite, Running tests, Testing

### Community 53 - "Community 53"
Cohesion: 0.5
Nodes (3): Answer, Q: Why does Orchestrator connect 7 communities (post-prune2)?, Source Nodes

### Community 54 - "Community 54"
Cohesion: 0.5
Nodes (3): Answer, Q: Why does handleImageUpload bridge Orchestrator Core and Checkpoint Replay?, Source Nodes

### Community 55 - "Community 55"
Cohesion: 0.5
Nodes (3): Answer, Q: Why does Orchestrator connect Auth to Lifecycle, GraphQL Resolvers, Web App Shell, Domain Models?, Source Nodes

## Knowledge Gaps
- **243 isolated node(s):** `code:block1 (transition({ taskId, to, blockReason?, event: { type, actor,)`, `Outcome`, `code:block2 (plan(task, deps) → { kind: 'ok', plan: SpawnPlan })`, `Added`, `Changed` (+238 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `generateId()` connect `Community 18` to `Community 0`, `Community 33`, `Community 36`, `Community 6`, `Community 9`, `Community 11`, `Community 13`, `Community 15`, `Community 17`, `Community 20`, `Community 21`, `Community 22`, `Community 26`, `Community 27`, `Community 28`, `Community 29`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Why does `createTables()` connect `Community 21` to `Community 0`, `Community 36`, `Community 6`, `Community 9`, `Community 10`, `Community 11`, `Community 13`, `Community 15`, `Community 17`, `Community 18`, `Community 20`, `Community 28`, `Community 29`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `handleImageUpload()` connect `Community 27` to `Community 34`, `Community 18`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Are the 37 inferred relationships involving `generateId()` (e.g. with `insertQueuedTask()` and `insertRunningTask()`) actually correct?**
  _`generateId()` has 37 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `createTables()` (e.g. with `seedDb()` and `setup()`) actually correct?**
  _`createTables()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `getCurrentUser()` (e.g. with `insertTask()` and `insertTask()`) actually correct?**
  _`getCurrentUser()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **What connects `code:block1 (transition({ taskId, to, blockReason?, event: { type, actor,)`, `Outcome`, `code:block2 (plan(task, deps) → { kind: 'ok', plan: SpawnPlan })` to the rest of the system?**
  _243 weakly-connected nodes found - possible documentation gaps or missing edges._