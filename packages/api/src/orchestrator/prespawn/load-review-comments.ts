import { consola } from 'consola'
import { formatReviewComments } from './format-review-comments'
import type { GitHubReviewCommentsAdapter } from './types'

export async function loadReviewComments(
  task: { action: string | null; prUrl: string | null },
  github: GitHubReviewCommentsAdapter,
): Promise<string | undefined> {
  if (task.action !== 'revise' || !task.prUrl) return undefined
  try {
    const comments = await github.fetchReviewComments(task.prUrl)
    if (comments.length === 0) {
      consola.info(`loadReviewComments: no comments found for ${task.prUrl}`)
      return undefined
    }
    consola.info(`loadReviewComments: ${comments.length} comment(s) from ${task.prUrl}`)
    return formatReviewComments(comments)
  } catch (err) {
    consola.warn(`loadReviewComments: ${err}`)
    return undefined
  }
}
