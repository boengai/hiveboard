import Mustache from 'mustache'

/** Disable Mustache's default HTML escaping — we output plain text. */
Mustache.escape = (text: string) => text

export type TaskForPrompt = {
  id: string
  title: string
  body: string
  action: string | null
  targetRepo: string | null
  targetBranch: string | null
}

export type PromptContext = {
  task: {
    number: string
    title: string
    body: string
    action: string
    repo_owner: string
    repo_name: string
    target_branch: string
    labels: string
    url: string
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
      body: task.body,
      labels: '',
      number: task.id,
      repo_name: repoName ?? '',
      repo_owner: repoOwner ?? '',
      target_branch: task.targetBranch ?? 'main',
      title: task.title,
      url: '',
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
