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
    git checkout -b issue-{{ task.number }}/{{ task.action }}
claude:
  command: claude
  model: sonnet
  max_turns: 50
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

You are working on GitHub issue #{{ task.number }} in {{ task.repo_owner }}/{{ task.repo_name }}

Action: {{ task.action }}

Issue context:
Title: {{ task.title }}
URL: {{ task.url }}
Labels: {{ task.labels }}

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
3. Before starting work, fetch the latest issue body to get the full acceptance criteria:
   `gh issue view {{ task.number }} --repo {{ task.repo_owner }}/{{ task.repo_name }} --json body --jq .body`
4. Follow the action-specific instructions below for action "{{ task.action }}".
5. Final message must report completed actions and blockers only. Do not include "next steps for user".

### Action: plan
If the action is "plan", do NOT write any code. Instead:
- Research the issue context using all available methods:
   a. Search the codebase (grep for relevant patterns, read key files, trace call paths).
   b. Review git history for related changes (`git log`, `git blame`).
   c. Check existing documentation, comments, and tests.
- Write a detailed implementation plan covering: findings from research, approach, files to create/modify, key decisions, risks, and estimated complexity.
- Fetch the current issue body. If a `## Implementation Plan` section already exists, replace it; otherwise append it:
  `gh issue edit {{ task.number }} --repo {{ task.repo_owner }}/{{ task.repo_name }} --body "$(updated body with plan)"`
- Do NOT commit, push, or create a PR.

### Action: implement
If the action is "implement":
- Implement the changes described in the issue.
- Before committing, verify your changes:
   a. Run `bun run lint` and fix any errors.
   b. Run `bun test` and ensure all tests pass.
- After verification passes:
   a. Commit all changes with a descriptive commit message referencing issue #{{ task.number }}.
   b. Push the branch to the remote (`git push -u origin HEAD`).
   c. Create a pull request using `gh pr create` targeting the main branch, referencing "Closes #{{ task.number }}" in the body.
   d. Link the PR on the issue by posting a comment with the PR URL:
      `gh issue comment {{ task.number }} --repo {{ task.repo_owner }}/{{ task.repo_name }} --body "PR: $(gh pr view --json url --jq .url)"`
   e. Check off completed acceptance criteria on the issue by updating the issue body — replace `- [ ]` with `- [x]` for each item you completed:
      `gh issue edit {{ task.number }} --repo {{ task.repo_owner }}/{{ task.repo_name }} --body "$(updated body)"`

### Action: implement-e2e
If the action is "implement-e2e":
- Same as "implement", but also write end-to-end tests that cover the feature's key user flows.
- Place test files alongside existing tests or in the appropriate `__tests__`/`tests` directory.
- Tests should verify both the happy path and important edge cases.
- All tests (existing and new) must pass before committing.
- Follow the same verification, commit, push, PR, and link steps as "implement".

### Action: revise
If the action is "revise":
{{#has_review_comments}}
- Focus exclusively on addressing the review comments listed above.
- Read each comment carefully. If it references a specific file and line, go directly to that location.
- Make the minimal, targeted changes needed to satisfy each comment.
- Do not refactor, reformat, or change code that is not related to the review feedback.
{{/has_review_comments}}
{{^has_review_comments}}
- Check the existing PR for review comments using `gh pr view --json reviewDecision,reviews`.
- Address each review comment with targeted changes.
{{/has_review_comments}}
- After addressing all comments, verify your changes:
   a. Run `bun run lint` and fix any errors.
   b. Run `bun test` and ensure all tests pass.
- After verification passes:
   a. Commit changes with a message summarizing what was revised.
   b. Push to the same branch (`git push`).
   c. If any review comment affects the plan, approach, or acceptance criteria (e.g. scope changes, new requirements, architectural feedback), update the issue body to reflect those changes:
      `gh issue edit {{ task.number }} --repo {{ task.repo_owner }}/{{ task.repo_name }} --body "$(updated body)"`

Work only in the provided repository copy. Do not touch any other path.
