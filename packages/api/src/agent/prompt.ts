import type { Database } from 'bun:sqlite'
import Mustache from 'mustache'
import { getPlaybookByName } from '../playbooks'
import {
  type RenderPlaybookPromptInput,
  renderPlaybookPrompt,
} from '../playbooks/render'
import { buildPromptContext } from './prompt-context'
import { loadPromptPartials } from './prompt-partials'

/** Disable Mustache's default HTML escaping — we output plain text. */
Mustache.escape = (text: string) => text

export type TaskForPrompt = {
  id: string
  title: string
  body: string
  action: string | null
  agentInstruction: string | null
  targetRepo: string | null
  targetBranch: string | null
  prUrl: string | null
}

export type RunAgentMessage = {
  kind: 'hint' | 'redirect' | 'answer'
  body: string
  created_at: string
}

export type VerificationFailureForPrompt = {
  label: string
  command: string
  exit_code: number
  output: string
}

export type PreviousAttemptReplayForPrompt = {
  failure_summary: string
  turn_count: number
  checkpoints: Array<{ turn: number; kind: string; summary: string }>
}

export type { PromptContext } from './prompt-context'

export type RenderPromptResolver = {
  db: Database
}

/** Render a Mustache template with task context. */
export function renderPrompt(
  template: string,
  task: TaskForPrompt,
  attempt?: number,
  reviewComments?: string,
  scratchpad?: string,
  messages?: RunAgentMessage[],
  verification?: { verification_failures: VerificationFailureForPrompt[] },
  previousAttemptReplay?: PreviousAttemptReplayForPrompt,
  resolver?: RenderPromptResolver,
  requiredSecrets?: Array<{ name: string; description?: string | null }>,
): string {
  const context = buildPromptContext({
    attempt,
    messages,
    previousAttemptReplay,
    requiredSecrets,
    reviewComments,
    scratchpad,
    task,
    verificationFailures: verification?.verification_failures,
  })

  // Playbook dispatch path: same context, different template body.
  if (task.action?.startsWith('playbook:')) {
    if (!resolver) {
      throw new Error(
        'renderPrompt: playbook action requires a resolver with { db }',
      )
    }
    const name = task.action.slice('playbook:'.length)
    const pb = getPlaybookByName(resolver.db, name)
    if (!pb) throw new Error(`Playbook not found: ${name}`)
    const input: RenderPlaybookPromptInput = {
      attempt,
      messages,
      playbookBody: pb.currentVersion.promptTemplate,
      previousAttemptReplay,
      requiredSecrets,
      reviewComments,
      scratchpad,
      task,
      verificationFailures: verification?.verification_failures,
    }
    return renderPlaybookPrompt(input)
  }

  return Mustache.render(template, context, loadPromptPartials())
}

/** Continuation prompt for retry turns. */
export const CONTINUATION_PROMPT = `
This is a continuation run. The workspace still contains your previous work.
Resume from the current state instead of starting from scratch.
Do not repeat already-completed work unless needed for new changes.
`.trim()
