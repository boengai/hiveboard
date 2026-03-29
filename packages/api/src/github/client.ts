import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'
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
  private octokit: Octokit
  private isAppAuth: boolean
  private jwtOctokit: Octokit | null = null
  private cachedToken: string | null = null
  private tokenExpiresAt = 0
  private _identity: GitIdentity | null = null
  private pat: string | null = null

  private constructor(
    octokit: Octokit,
    isAppAuth: boolean,
    opts?: { jwtOctokit?: Octokit; pat?: string },
  ) {
    this.octokit = octokit
    this.isAppAuth = isAppAuth
    this.jwtOctokit = opts?.jwtOctokit ?? null
    this.pat = opts?.pat ?? null
  }

  /**
   * Create a GitHubClient with auth auto-detected from env vars:
   * - GITHUB_TOKEN → PAT mode (rejects ghs_ installation tokens)
   * - GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + GITHUB_APP_INSTALLATION_ID → App mode
   */
  static create(): GitHubClient {
    const pat = process.env.GITHUB_TOKEN
    const appId = process.env.GITHUB_APP_ID
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
    const installationId = process.env.GITHUB_APP_INSTALLATION_ID

    if (pat) {
      if (pat.startsWith('ghs_')) {
        throw new Error(
          'Bare ghs_ installation tokens are not supported — they cannot resolve identity. ' +
            'Use a personal access token (GITHUB_TOKEN=ghp_...) or configure full GitHub App auth: ' +
            'GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_INSTALLATION_ID.',
        )
      }
      consola.debug('GitHub client initialized with PAT auth')
      const octokit = new Octokit({ auth: pat })
      return new GitHubClient(octokit, false, { pat })
    }

    if (appId && privateKey && installationId) {
      const authOpts = {
        appId,
        installationId: Number(installationId),
        privateKey,
      }
      const octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: authOpts,
      })
      // Separate Octokit instance for JWT-level calls (GET /app for identity).
      // Only appId + privateKey — no installationId — so createAppAuth defaults to JWT.
      const jwtOctokit = new Octokit({
        authStrategy: createAppAuth,
        auth: { appId, privateKey },
      })
      consola.debug('GitHub client initialized with GitHub App auth')
      return new GitHubClient(octokit, true, { jwtOctokit })
    }

    throw new Error(
      'GitHub auth not configured. Set GITHUB_TOKEN (personal access token), or set all of ' +
        'GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_INSTALLATION_ID.',
    )
  }

  /**
   * Get a raw access token string for subprocess env vars (gh, git).
   * - PAT: returns the static token.
   * - App: generates an installation token, caches for 45 min.
   * Sets process.env.GITHUB_TOKEN so subprocesses pick it up.
   */
  async getAccessToken(): Promise<string> {
    if (!this.isAppAuth) {
      return this.pat as string
    }

    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken
    }

    const auth = (await this.octokit.auth({
      type: 'installation',
    })) as { token: string }
    this.cachedToken = auth.token
    this.tokenExpiresAt = Date.now() + TOKEN_REFRESH_MS
    process.env.GITHUB_TOKEN = auth.token
    consola.debug('GitHub App token refreshed')
    return auth.token
  }

  /**
   * Fetch the git identity from GitHub.
   * - App: GET /app via JWT → "{slug}[bot]"
   * - PAT: GET /user → user profile
   * Cached after first call.
   */
  async getIdentity(): Promise<GitIdentity> {
    if (this._identity) return this._identity

    if (this.isAppAuth && this.jwtOctokit) {
      try {
        const { data } = await this.jwtOctokit.rest.apps.getAuthenticated()
        if (data?.slug && data.id) {
          this._identity = {
            email: `${data.id}+${data.slug}[bot]@users.noreply.github.com`,
            name: `${data.slug}[bot]`,
          }
        }
      } catch (err) {
        consola.warn('Failed to fetch GitHub App identity:', err)
      }
    } else {
      try {
        const { data } = await this.octokit.rest.users.getAuthenticated()
        if (data.login && data.id) {
          this._identity = {
            email: `${data.id}+${data.login}@users.noreply.github.com`,
            name: data.name || data.login,
          }
        }
      } catch (err) {
        consola.warn('Failed to fetch GitHub user identity:', err)
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
   * Create a pull request via the GitHub API.
   * Returns the PR URL on success.
   */
  async createPullRequest(
    repo: { owner: string; repo: string },
    title: string,
    body: string,
    baseBranch: string,
    headBranch: string,
  ): Promise<string> {
    const { data } = await this.octokit.rest.pulls.create({
      owner: repo.owner,
      repo: repo.repo,
      title,
      body,
      base: baseBranch,
      head: headBranch,
    })
    consola.info(`Created PR: ${data.html_url}`)
    return data.html_url
  }

  /**
   * Fetch PR review comments for a given PR URL.
   */
  async fetchReviewComments(prUrl: string): Promise<ReviewComment[]> {
    const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
    if (!match) {
      throw new Error(`Cannot parse PR URL: ${prUrl}`)
    }

    const [, owner, repo, number] = match as [string, string, string, string]

    try {
      const { data } = await this.octokit.rest.pulls.listReviewComments({
        owner,
        repo,
        pull_number: Number(number),
      })

      const comments: ReviewComment[] = data.map((c) => ({
        author: c.user?.login ?? 'unknown',
        body: c.body,
        path: c.path ?? null,
        line: c.line ?? null,
        diffHunk: c.diff_hunk ?? null,
      }))

      consola.info(`Fetched ${comments.length} review comments from ${prUrl}`)
      return comments
    } catch (err) {
      consola.warn(`Failed to fetch review comments from ${prUrl}:`, err)
      return []
    }
  }
}
