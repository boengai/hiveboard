import Mustache from 'mustache'

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
}

/** Render a Mustache template with task context. */
export function renderPrompt(
  template: string,
  task: TaskForPrompt,
  attempt?: number,
  reviewComments?: string,
): string {
  const [repoOwner, repoName] = (task.targetRepo ?? '/').split('/')

  const context: PromptContext = {
    attempt,
    has_review_comments: !!reviewComments,
    review_comments: reviewComments,
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
  }

  return Mustache.render(template, context)
}

/** Continuation prompt for retry turns. */
export const CONTINUATION_PROMPT = `
This is a continuation run. The workspace still contains your previous work.
Resume from the current state instead of starting from scratch.
Do not repeat already-completed work unless needed for new changes.
`.trim()
