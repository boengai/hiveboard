import { createAppAuth } from '@octokit/auth-app'
import { consola } from 'consola'

export type ReviewComment = {
  author: string
  body: string
  path: string | null
  line: number | null
  diffHunk: string | null
}

export class GitHubClient {
  private getToken: () => Promise<string>
  private isAppAuth: boolean

  private constructor(
    getToken: () => Promise<string>,
    isAppAuth: boolean,
  ) {
    this.getToken = getToken
    this.isAppAuth = isAppAuth
  }

  /**
   * Create a GitHubClient with auth auto-detected from env vars:
   * - GITHUB_TOKEN → PAT mode (static token)
   * - GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + GITHUB_APP_INSTALLATION_ID → App mode
   */
  static create(): GitHubClient {
    const pat = process.env.GITHUB_TOKEN
    const appId = process.env.GITHUB_APP_ID
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
    const installationId = process.env.GITHUB_APP_INSTALLATION_ID

    if (pat) {
      consola.debug('GitHub client initialized with PAT auth')
      return new GitHubClient(async () => pat, false)
    }

    if (appId && privateKey && installationId) {
      const auth = createAppAuth({
        appId,
        installationId: Number(installationId),
        privateKey,
      })

      const getToken = async () => {
        const { token } = await auth({ type: 'installation' })
        return token
      }

      consola.debug('GitHub client initialized with GitHub App auth')
      return new GitHubClient(getToken, true)
    }

    throw new Error(
      'GitHub auth not configured. Set GITHUB_TOKEN, or set all of ' +
        'GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_INSTALLATION_ID.',
    )
  }

  /**
   * Get a fresh access token (for injection into hook env).
   * For App auth, generates a short-lived installation token.
   * For PAT auth, returns the static token.
   */
  async getAccessToken(): Promise<string> {
    const token = await this.getToken()
    if (this.isAppAuth) {
      process.env.GITHUB_TOKEN = token
    }
    return token
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
    const token = await this.getAccessToken()
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
        env: { ...process.env, GITHUB_TOKEN: token },
        stderr: 'pipe',
        stdout: 'pipe',
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
    const token = await this.getAccessToken()

    const proc = Bun.spawn(
      [
        'gh',
        'api',
        `repos/${owner}/${repo}/pulls/${number}/comments`,
        '--jq',
        '[.[] | {author: .user.login, body: .body, path: .path, line: .line, diffHunk: .diff_hunk}]',
      ],
      {
        env: { ...process.env, GITHUB_TOKEN: token },
        stderr: 'pipe',
        stdout: 'pipe',
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
