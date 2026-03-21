import Mustache from 'mustache'

/** Disable Mustache's default HTML escaping — we output plain text. */
Mustache.escape = (text: string) => text

export type TaskForPrompt = {
  id: string
  title: string
  body: string
  action: string | null
  targetRepo: string | null
}

export type PromptContext = {
  issue: {
    number: string
    title: string
    body: string
    action: string
    repo_owner: string
    repo_name: string
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
    issue: {
      number: task.id,
      title: task.title,
      body: task.body,
      action: task.action ?? '',
      repo_owner: repoOwner ?? '',
      repo_name: repoName ?? '',
      labels: '',
      url: '',
    },
    attempt,
    review_comments: reviewComments,
    has_review_comments: !!reviewComments,
  }

  return Mustache.render(template, context)
}

/** Continuation prompt for retry turns. */
export const CONTINUATION_PROMPT = `
This is a continuation run. The workspace still contains your previous work.
Resume from the current state instead of starting from scratch.
Do not repeat already-completed work unless needed for new changes.
`.trim()
