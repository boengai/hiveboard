---
tracker:
  kind: github
  owner: $GITHUB_OWNER
  project_number: $GITHUB_PROJECT_NUMBER
  labels:
    action_prefix: "action:"
    repo_prefix: "repo:"
    status_running: "status:running"
    status_failed: "status:failed"
  columns:
    backlog: "Backlog"
    todo: "Todo"
    in_progress: "In Progress"
    review: "Review"
    done: "Done"
polling:
  interval_ms: 30000
workspace:
  root: ./tmp/workspaces    # workspace root directory
  ttl_ms: 259200000         # 72 hours — stale workspace cleanup
hooks:
  after_create: >-
    git clone --depth 1 https://x-access-token:${GITHUB_TOKEN}@github.com/{{ issue.repo_owner }}/{{ issue.repo_name }} . &&
    git checkout -b issue-{{ issue.number }}/{{ issue.action }}
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

You are working on GitHub issue #{{ issue.number }} in {{ issue.repo_owner }}/{{ issue.repo_name }}

Action: {{ issue.action }}

Issue context:
Title: {{ issue.title }}
URL: {{ issue.url }}
Labels: {{ issue.labels }}

Description:
{{ issue.body }}

{{#has_review_comments}}
## Review Comments to Address

The following review comments were left on the pull request. Your ONLY task is to address each of these comments. Do not refactor unrelated code or add features beyond what the reviewers requested.

{{{ review_comments }}}
{{/has_review_comments}}

Instructions:

1. This is an unattended orchestration session. Never ask a human to perform follow-up actions.
2. Only stop early for a true blocker (missing required auth/permissions/secrets).
3. Before starting work, fetch the latest issue body to get the full acceptance criteria:
   `gh issue view {{ issue.number }} --repo {{ issue.source_owner }}/{{ issue.source_repo }} --json body --jq .body`
4. Follow the action-specific instructions below for action "{{ issue.action }}".
5. Final message must report completed actions and blockers only. Do not include "next steps for user".

### Action: plan
If the action is "plan", do NOT write any code. Instead:
- Read the issue and the existing codebase to understand context.
- Write a detailed implementation plan covering: approach, files to create/modify, key decisions, risks, and estimated complexity.
- Append the plan to the issue body using `gh issue edit`. Fetch the current body first, then append a `## Implementation Plan` section:
  `gh issue edit {{ issue.number }} --repo {{ issue.source_owner }}/{{ issue.source_repo }} --body "$(current body + plan)"`
- Do NOT commit, push, or create a PR.

### Action: implement
If the action is "implement":
- Implement the changes described in the issue.
- After completing the work:
   a. Commit all changes with a descriptive commit message referencing issue #{{ issue.number }}.
   b. Push the branch to the remote (`git push -u origin HEAD`).
   c. Create a pull request using `gh pr create` targeting the main branch, referencing "Closes #{{ issue.number }}" in the body.
   d. Link the PR on the issue by posting a comment with the PR URL:
      `gh issue comment {{ issue.number }} --repo {{ issue.source_owner }}/{{ issue.source_repo }} --body "PR: $(gh pr view --json url --jq .url)"`
   e. Check off completed acceptance criteria on the issue by updating the issue body — replace `- [ ]` with `- [x]` for each item you completed:
      `gh issue edit {{ issue.number }} --repo {{ issue.source_owner }}/{{ issue.source_repo }} --body "$(updated body)"`

### Action: implement-e2e
If the action is "implement-e2e":
- Same as "implement", but also write end-to-end tests that verify the feature works.
- Tests must pass before committing.
- Follow the same commit, push, PR, and link steps as "implement".

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
- After addressing all comments:
   a. Commit changes with a message summarizing what was revised.
   b. Push to the same branch (`git push`).
   c. If any review comment affects the plan, approach, or acceptance criteria (e.g. scope changes, new requirements, architectural feedback), update the issue body to reflect those changes:
      `gh issue edit {{ issue.number }} --repo {{ issue.source_owner }}/{{ issue.source_repo }} --body "$(updated body)"`

Work only in the provided repository copy. Do not touch any other path.
