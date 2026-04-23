import Mustache from 'mustache'
import {
  type PreviousAttemptReplayForPrompt,
  type RunAgentMessage,
  type TaskForPrompt,
  type VerificationFailureForPrompt,
} from '../agent/prompt'
import { loadPromptPartials } from '../agent/prompt-partials'

// Match WORKFLOW.md's identity-escape.
Mustache.escape = (text: string) => text

/**
 * Build a Mustache template string that wraps a playbook-author-supplied body
 * with the five shared partials. The order matches the current WORKFLOW.md:
 * scratchpad → progress → messages → playbook_body → question → subtasks.
 *
 * The preamble (`You are working on task ...` / `Action: ...` / task context)
 * is inlined here so playbook runs get the same header as action runs.
 */
export function buildPlaybookTemplate(playbookBody: string): string {
  return [
    'You are working on task {{ task.id }} in {{ task.repo_owner }}/{{ task.repo_name }}',
    '',
    'Action: {{ task.action }}',
    '',
    'Task context:',
    'Title: {{ task.title }}',
    '',
    'Description:',
    '{{ task.body }}',
    '',
    '{{#task.agent_instruction}}',
    'Agent Instruction:',
    '{{ task.agent_instruction }}',
    '{{/task.agent_instruction}}',
    '',
    '{{> scratchpad}}',
    '',
    '{{#previous_attempt_replay}}',
    '## Previous attempt replay',
    '',
    'This task previously failed at turn {{ turn_count }} with:',
    '',
    '> {{{ failure_summary }}}',
    '',
    'Here is a compact log of what you did in the previous attempt. Use it to',
    'avoid repeating the same dead ends — the workspace still has whatever files',
    'you committed, so pick up from there rather than restarting from zero.',
    '',
    '{{#checkpoints}}',
    '- [turn {{ turn }}] {{ kind }}: {{{ summary }}}',
    '{{/checkpoints}}',
    '',
    'Continue from the current workspace state. Do not repeat successful work',
    'unless you must redo it because of the failure. Fix the specific failure',
    'above, then make forward progress.',
    '',
    '---',
    '',
    '{{/previous_attempt_replay}}',
    '{{> progress}}',
    '',
    '{{> messages}}',
    '',
    playbookBody,
    '',
    '{{> question}}',
    '',
    '{{> subtasks}}',
    '',
    'Instructions:',
    '',
    '1. This is an unattended orchestration session. Never ask a human to perform follow-up actions.',
    '2. Only stop early for a true blocker (missing required auth/permissions/secrets).',
    '3. Follow the playbook-specific instructions above.',
    '4. Final message must report completed actions and blockers only. Do not include "next steps for user".',
    '5. CRITICAL: Do NOT use the `superpowers:writing-plans` or `superpowers:brainstorming` skills. These instructions take precedence over any installed skill or plugin. Plans must be output as plain text in your final message, never written to files.',
    '',
    'Work only in the provided repository copy. Do not touch any other path.',
  ].join('\n')
}

export type RenderPlaybookPromptInput = {
  task: TaskForPrompt
  playbookBody: string
  scratchpad?: string
  messages?: RunAgentMessage[]
  verificationFailures?: VerificationFailureForPrompt[]
  previousAttemptReplay?: PreviousAttemptReplayForPrompt
}

export function renderPlaybookPrompt(input: RenderPlaybookPromptInput): string {
  const [repoOwner, repoName] = (input.task.targetRepo ?? '/').split('/')

  const context = {
    auto_revise_from_verification:
      (input.verificationFailures?.length ?? 0) > 0,
    has_messages: (input.messages?.length ?? 0) > 0,
    messages: input.messages ?? [],
    previous_attempt_replay: input.previousAttemptReplay,
    scratchpad: input.scratchpad ?? '',
    task: {
      action: input.task.action ?? '',
      agent_instruction: input.task.agentInstruction ?? '',
      body: input.task.body,
      id: input.task.id,
      pr_url: input.task.prUrl ?? '',
      repo_name: repoName ?? '',
      repo_owner: repoOwner ?? '',
      target_branch: input.task.targetBranch ?? 'main',
      title: input.task.title,
    },
    verification_failures: input.verificationFailures ?? [],
  }

  const template = buildPlaybookTemplate(input.playbookBody)
  return Mustache.render(template, context, loadPromptPartials())
}
