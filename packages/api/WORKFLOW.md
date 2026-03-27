---
tracker:
  kind: github
  owner: $GITHUB_OWNER
  project_number: $GITHUB_PROJECT_NUMBER
polling:
  interval_ms: 30000
workspace:
  root: ./tmp/workspaces    # workspace root directory
  ttl_ms: 259200000         # 72 hours — stale workspace cleanup
hooks:
  after_create: >-
    git clone --depth 1 https://x-access-token:${GITHUB_TOKEN}@github.com/{{ task.repo_owner }}/{{ task.repo_name }} . &&
    git checkout -b task-{{ task.short_id }}/{{ task.slug }}
claude:
  command: claude
  model: opus
  max_turns: 200
  permission_mode: bypassPermissions
  allowed_tools:
    - Bash
    - Read
    - Write
    - Edit
    - Glob
    - Grep
agent:
  max_concurrent_agents: 5
  max_retry_backoff_ms: 300000
worker:
  ssh_hosts: []
---

You are working on task {{ task.id }} in {{ task.repo_owner }}/{{ task.repo_name }}

Action: {{ task.action }}

Task context:
Title: {{ task.title }}

Description:
{{ task.body }}

{{#has_review_comments}}

## Review Comments to Address

The following review comments were left on the pull request. Your ONLY task is to address each of these comments. Do not refactor unrelated code or add features beyond what the reviewers requested.

{{{ review_comments }}}
{{/has_review_comments}}

Instructions:

1. This is an unattended orchestration session. Never ask a human to perform follow-up actions.
2. Only stop early for a true blocker (missing required auth/permissions/secrets).
3. Follow the action-specific instructions below for action "{{ task.action }}".
4. Final message must report completed actions and blockers only. Do not include "next steps for user".
5. CRITICAL: Do NOT use the `superpowers:writing-plans` or `superpowers:brainstorming` skills. These instructions take precedence over any installed skill or plugin. Plans must be output as plain text in your final message, never written to files.

### Action: plan
If the action is "plan", do NOT write any code. Instead:
- Research the codebase using all available methods:
   a. Search the codebase (grep for relevant patterns, read key files, trace call paths).
   b. Review git history for related changes (`git log`, `git blame`).
   c. Check existing documentation, comments, and tests.
   d. Identify the project's build system, linter, test runner, and verification commands (e.g. check `package.json` scripts, `Makefile`, `Cargo.toml`, CI config, etc.).
   e. Check for an existing end-to-end test setup (Playwright, Cypress, etc.). If one exists, the plan MUST include e2e tests covering the feature's key user flows and edge cases.
- Write a detailed implementation plan covering: findings from research, approach, files to create/modify, key decisions, risks, and estimated complexity.
- The plan MUST include a **Verification** section listing the exact commands to run for linting, testing, and building — discovered from the project, not assumed.
- Output the plan as plain text in your final message — this is how the orchestrator captures it for the task body. Do NOT use the Write tool or any skill to save the plan to a file. Do NOT commit, push, or create a PR.

### Action: implement
If the action is "implement":
- Implement the changes described in the task.
- If the implementation plan includes end-to-end tests (e.g. the project has an e2e setup like Playwright, Cypress, etc.), also write e2e tests covering the feature's key user flows and important edge cases. Place test files alongside existing tests or in the appropriate test directory.
- Before committing, verify your changes using the verification commands described in the task's implementation plan. If no plan exists, discover the project's lint/test/build commands from its config files (package.json, Makefile, etc.) and run them.
- All tests (existing and new) must pass before committing.
- After verification passes:
   a. Commit all changes with a descriptive commit message.
   b. Push the branch to the remote (`git push -u origin HEAD`).
   c. Create a pull request using `gh pr create` targeting the {{ task.target_branch }} branch.

### Action: revise
If the action is "revise":
{{#has_review_comments}}
- Focus exclusively on addressing the review comments listed above.
- Read each comment carefully. If it references a specific file and line, go directly to that location.
- Make the minimal, targeted changes needed to satisfy each comment.
- Do not refactor, reformat, or change code that is not related to the review feedback.
{{/has_review_comments}}
{{^has_review_comments}}
- Check the existing PR for review comments: `gh pr view {{ task.pr_url }} --json reviewDecision,reviews`.
- Address each review comment with targeted changes.
{{/has_review_comments}}
- After addressing all comments, verify your changes using the verification commands described in the task's implementation plan. If no plan exists, discover the project's lint/test/build commands from its config files and run them.
- After verification passes:
   a. Commit changes with a message summarizing what was revised.
   b. Push to the same branch (`git push`).
   c. Resolve each addressed review thread on the PR. First list the threads:
      `gh api graphql -f query='{ repository(owner:"{{ task.repo_owner }}", name:"{{ task.repo_name }}") { pullRequest(number:PR_NUMBER) { reviewThreads(first:100) { nodes { id isResolved } } } } }'`
      Then resolve each unresolved thread:
      `gh api graphql -f query='mutation { resolveReviewThread(input:{threadId:"THREAD_ID"}) { thread { id } } }'`

Work only in the provided repository copy. Do not touch any other path.
