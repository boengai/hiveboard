import type { Database } from 'bun:sqlite'
import Mustache from 'mustache'
import { getPlaybookByName } from '../playbooks'
import {
  type RenderPlaybookPromptInput,
  renderPlaybookPrompt,
} from '../playbooks/render'
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

export type PromptContext = {
  task: {
    id: string
    title: string
    body: string
    action: string
    agent_instruction: string
    repo_owner: string
    repo_name: string
    target_branch: string
    pr_url: string
  }
  attempt?: number
  review_comments?: string
  has_review_comments?: boolean
  scratchpad?: string
  messages?: RunAgentMessage[]
  has_messages?: boolean
  auto_revise_from_verification?: boolean
  verification_failures?: VerificationFailureForPrompt[]
}

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
  resolver?: RenderPromptResolver,
): string {
  // Playbook dispatch path
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
      messages,
      playbookBody: pb.currentVersion.promptTemplate,
      scratchpad,
      task,
      verificationFailures: verification?.verification_failures,
    }
    return renderPlaybookPrompt(input)
  }

  // Existing WORKFLOW.md path — unchanged
  const [repoOwner, repoName] = (task.targetRepo ?? '/').split('/')

  const context: PromptContext = {
    attempt,
    auto_revise_from_verification:
      (verification?.verification_failures?.length ?? 0) > 0,
    has_messages: (messages?.length ?? 0) > 0,
    has_review_comments: !!reviewComments,
    messages: messages ?? [],
    review_comments: reviewComments,
    scratchpad: scratchpad ?? '',
    task: {
      action: task.action ?? '',
      agent_instruction: task.agentInstruction ?? '',
      body: task.body,
      id: task.id,
      pr_url: task.prUrl ?? '',
      repo_name: repoName ?? '',
      repo_owner: repoOwner ?? '',
      target_branch: task.targetBranch ?? 'main',
      title: task.title,
    },
    verification_failures: verification?.verification_failures ?? [],
  }

  return Mustache.render(template, context, loadPromptPartials())
}

/** Continuation prompt for retry turns. */
export const CONTINUATION_PROMPT = `
This is a continuation run. The workspace still contains your previous work.
Resume from the current state instead of starting from scratch.
Do not repeat already-completed work unless needed for new changes.
`.trim()
