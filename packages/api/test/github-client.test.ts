import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

describe('GitHubClient.create()', () => {
  const origEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.GITHUB_TOKEN
    delete process.env.GITHUB_APP_ID
    delete process.env.GITHUB_APP_PRIVATE_KEY
    delete process.env.GITHUB_APP_INSTALLATION_ID
  })

  afterEach(() => {
    process.env = { ...origEnv }
  })

  it('throws when no auth env vars are set', async () => {
    const { GitHubClient } = await import('../src/github/client')
    expect(() => GitHubClient.create()).toThrow('GitHub auth not configured')
  })

  it('throws when GITHUB_TOKEN starts with ghs_', async () => {
    process.env.GITHUB_TOKEN = 'ghs_fake_installation_token'
    const { GitHubClient } = await import('../src/github/client')
    expect(() => GitHubClient.create()).toThrow(
      'Bare ghs_ installation tokens are not supported',
    )
  })

  it('creates a client with a PAT token', async () => {
    process.env.GITHUB_TOKEN = 'ghp_fake_pat_token'
    const { GitHubClient } = await import('../src/github/client')
    const client = GitHubClient.create()
    expect(client).toBeDefined()
    const token = await client.getAccessToken()
    expect(token).toBe('ghp_fake_pat_token')
  })

  it('creates a client with GitHub App credentials', async () => {
    process.env.GITHUB_APP_ID = '12345'
    process.env.GITHUB_APP_PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----'
    process.env.GITHUB_APP_INSTALLATION_ID = '67890'
    const { GitHubClient } = await import('../src/github/client')
    const client = GitHubClient.create()
    expect(client).toBeDefined()
  })
})

describe('GitHubClient.fetchReviewComments()', () => {
  afterEach(() => {
    delete process.env.GITHUB_TOKEN
  })

  it('throws on invalid PR URL', async () => {
    process.env.GITHUB_TOKEN = 'ghp_fake'
    const { GitHubClient } = await import('../src/github/client')
    const client = GitHubClient.create()
    expect(client.fetchReviewComments('not-a-url')).rejects.toThrow(
      'Cannot parse PR URL',
    )
  })
})
