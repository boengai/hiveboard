import type { ReviewComment } from '../../github/client'
import { escapeMustacheSyntax } from '../mustache-escape'

/**
 * Format an array of PR review comments into a readable string for the agent prompt.
 * All user-provided fields are escaped to prevent Mustache/template injection.
 */
export function formatReviewComments(comments: ReviewComment[]): string {
  const lines: string[] = ['## PR Review Comments', '']
  for (const comment of comments) {
    lines.push(`### Comment by @${escapeMustacheSyntax(comment.author)}`)
    if (comment.path) {
      const escapedPath = escapeMustacheSyntax(comment.path)
      const location =
        comment.line != null ? `${escapedPath}:${comment.line}` : escapedPath
      lines.push(`File: \`${location}\``)
    }
    if (comment.diffHunk) {
      lines.push('```diff', escapeMustacheSyntax(comment.diffHunk), '```')
    }
    lines.push(escapeMustacheSyntax(comment.body), '')
  }
  return lines.join('\n').trim()
}
