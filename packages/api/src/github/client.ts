import { createAppAuth } from '@octokit/auth-app'
import { consola } from 'consola'

export type ReviewComment = {
  author: string
  body: string
  path: string | null
  line: number | null
  diffHunk: string | null
}

// GitHub App tokens last 1 hour. Refresh at 45 minutes to stay safe.
const TOKEN_REFRESH_MS = 45 * 60 * 1000

export type GitIdentity = {
  name: string
  email: string
}

export class GitHubClient {
  private getToken: () => Promise<string>
  private isAppAuth: boolean
  private cachedToken: string | null = null
  private tokenExpiresAt = 0
  private _identity: GitIdentity | null = null

  private constructor(getToken: () => Promise<string>, isAppAuth: boolean) {
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
   * Get an access token, refreshing only when expired or close to expiry.
   * For App auth, caches the token and refreshes every 45 minutes.
   * For PAT auth, returns the static token immediately.
   * Also sets process.env.GITHUB_TOKEN so subprocesses (gh, git) work.
   */
  async getAccessToken(): Promise<string> {
    if (!this.isAppAuth) {
      return this.getToken()
    }

    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken
    }

    const token = await this.getToken()
    this.cachedToken = token
    this.tokenExpiresAt = Date.now() + TOKEN_REFRESH_MS
    process.env.GITHUB_TOKEN = token
    consola.debug('GitHub App token refreshed')
    return token
  }

  /**
   * Fetch the git identity from GitHub.
   * - PAT: fetches authenticated user profile
   * - App: uses the app's slug as bot identity
   * Cached after first call.
   */
  async getIdentity(): Promise<GitIdentity> {
    if (this._identity) return this._identity

    const token = await this.getAccessToken()

    if (this.isAppAuth) {
      // GitHub App: GET /app returns { slug, id }
      // Bot commits should use: "app-slug[bot]" / "id+app-slug[bot]@users.noreply.github.com"
      const proc = Bun.spawn(
        ['gh', 'api', '/app', '--jq', '[.slug, .id] | @tsv'],
        {
          env: { ...process.env, GITHUB_TOKEN: token },
          stderr: 'pipe',
          stdout: 'pipe',
        },
      )
      const stdout = (
        await new Response(proc.stdout as ReadableStream).text()
      ).trim()
      await proc.exited
      const [slug, appId] = stdout.split('\t')
      if (slug && appId) {
        this._identity = {
          email: `${appId}+${slug}[bot]@users.noreply.github.com`,
          name: `${slug}[bot]`,
        }
      }
    } else {
      // PAT: GET /user returns { login, id, name }
      const proc = Bun.spawn(
        ['gh', 'api', '/user', '--jq', '[.login, .id, .name] | @tsv'],
        {
          env: { ...process.env, GITHUB_TOKEN: token },
          stderr: 'pipe',
          stdout: 'pipe',
        },
      )
      const stdout = (
        await new Response(proc.stdout as ReadableStream).text()
      ).trim()
      await proc.exited
      const [login, userId, displayName] = stdout.split('\t')
      if (login && userId) {
        this._identity = {
          email: `${userId}+${login}@users.noreply.github.com`,
          name: displayName || login,
        }
      }
    }

    if (!this._identity) {
      this._identity = {
        email: 'hiveboard[bot]@users.noreply.github.com',
        name: 'hiveboard[bot]',
      }
      consola.warn('Could not fetch GitHub identity, using fallback')
    }

    consola.info(
      `Git identity: ${this._identity.name} <${this._identity.email}>`,
    )
    return this._identity
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
