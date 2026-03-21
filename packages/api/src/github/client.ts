import { consola } from 'consola'

export type ReviewComment = {
  author: string
  body: string
  path: string | null
  line: number | null
  diffHunk: string | null
}

export class GitHubClient {
  private token: string

  constructor() {
    const token = process.env.GITHUB_TOKEN
    if (!token) {
      throw new Error('GITHUB_TOKEN environment variable is not set')
    }
    this.token = token
  }

  /**
   * Create a pull request using `gh pr create` in the given workspace.
   * Returns the PR URL on success.
   */
  async createPullRequest(
    workspacePath: string,
    title: string,
    body: string,
    baseBranch: string,
    headBranch: string,
  ): Promise<string> {
    const proc = Bun.spawn(
      [
        'gh',
        'pr',
        'create',
        '--title',
        title,
        '--body',
        body,
        '--base',
        baseBranch,
        '--head',
        headBranch,
      ],
      {
        cwd: workspacePath,
        env: { ...process.env, GITHUB_TOKEN: this.token },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )

    const exitCode = await proc.exited
    const stdout = await new Response(proc.stdout as ReadableStream).text()
    const stderr = await new Response(proc.stderr as ReadableStream).text()

    if (exitCode !== 0) {
      throw new Error(`gh pr create failed (exit ${exitCode}): ${stderr}`)
    }

    const prUrl = stdout.trim()
    consola.info(`Created PR: ${prUrl}`)
    return prUrl
  }

  /**
   * Fetch PR review comments for a given PR URL.
   * Uses `gh api` to get review comments from the PR.
   */
  async fetchReviewComments(prUrl: string): Promise<ReviewComment[]> {
    // Extract owner/repo/number from PR URL
    // e.g. https://github.com/owner/repo/pull/123
    const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
    if (!match) {
      throw new Error(`Cannot parse PR URL: ${prUrl}`)
    }

    const [, owner, repo, number] = match

    const proc = Bun.spawn(
      [
        'gh',
        'api',
        `repos/${owner}/${repo}/pulls/${number}/comments`,
        '--jq',
        '[.[] | {author: .user.login, body: .body, path: .path, line: .line, diffHunk: .diff_hunk}]',
      ],
      {
        env: { ...process.env, GITHUB_TOKEN: this.token },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )

    const exitCode = await proc.exited
    const stdout = await new Response(proc.stdout as ReadableStream).text()
    const stderr = await new Response(proc.stderr as ReadableStream).text()

    if (exitCode !== 0) {
      throw new Error(`gh api failed (exit ${exitCode}): ${stderr}`)
    }

    try {
      const comments = JSON.parse(stdout) as ReviewComment[]
      consola.info(`Fetched ${comments.length} review comments from ${prUrl}`)
      return comments
    } catch {
      consola.warn(
        `Failed to parse review comments from ${prUrl}: ${stdout.slice(0, 200)}`,
      )
      return []
    }
  }
}
