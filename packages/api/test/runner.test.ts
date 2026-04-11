import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { buildAgentEnv } from '../src/agent/env'
import type { TaskForAgent } from '../src/agent/runner'

const TASK: TaskForAgent = {
  action: 'implement',
  agentInstruction: null,
  body: 'Test body',
  id: 'task-001',
  prUrl: null,
  targetBranch: 'main',
  targetRepo: 'org/repo',
  title: 'Test task',
}

const WORKSPACE = '/tmp/workspace'

const GIT_IDENTITY = { email: 'bot@example.com', name: 'Bot' }

describe('buildAgentEnv', () => {
  const savedEnv = { ...process.env }

  beforeEach(() => {
    // Set up a controlled host environment
    process.env.PATH = '/usr/bin'
    process.env.HOME = '/home/user'
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    // Simulate leaked tokens in host env
    process.env.GITHUB_TOKEN = 'ghp_secret123'
    process.env.GH_TOKEN = 'gho_secret456'
    process.env.GITHUB_APP_ID = '12345'
    process.env.GITHUB_APP_PRIVATE_KEY = '-----BEGIN RSA-----'
    process.env.GITHUB_APP_INSTALLATION_ID = '67890'
  })

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key]
      }
    }
    Object.assign(process.env, savedEnv)
  })

  it('excludes GITHUB_TOKEN and related secrets', () => {
    const env = buildAgentEnv(TASK, WORKSPACE)

    expect(env.GITHUB_TOKEN).toBeUndefined()
    expect(env.GH_TOKEN).toBeUndefined()
    expect(env.GITHUB_APP_ID).toBeUndefined()
    expect(env.GITHUB_APP_PRIVATE_KEY).toBeUndefined()
    expect(env.GITHUB_APP_INSTALLATION_ID).toBeUndefined()
  })

  it('includes allowed host env vars', () => {
    const env = buildAgentEnv(TASK, WORKSPACE)

    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/home/user')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test')
  })

  it('includes task-specific vars', () => {
    const env = buildAgentEnv(TASK, WORKSPACE)

    expect(env.HIVEBOARD_TASK_ID).toBe('task-001')
    expect(env.HIVEBOARD_TASK_TITLE).toBe('Test task')
    expect(env.HIVEBOARD_WORKSPACE).toBe('/tmp/workspace')
  })

  it('includes git identity when provided', () => {
    const env = buildAgentEnv(TASK, WORKSPACE, GIT_IDENTITY)

    expect(env.GIT_AUTHOR_NAME).toBe('Bot')
    expect(env.GIT_AUTHOR_EMAIL).toBe('bot@example.com')
    expect(env.GIT_COMMITTER_NAME).toBe('Bot')
    expect(env.GIT_COMMITTER_EMAIL).toBe('bot@example.com')
  })

  it('omits git identity when not provided', () => {
    const env = buildAgentEnv(TASK, WORKSPACE)

    expect(env.GIT_AUTHOR_NAME).toBeUndefined()
    expect(env.GIT_AUTHOR_EMAIL).toBeUndefined()
    expect(env.GIT_COMMITTER_NAME).toBeUndefined()
    expect(env.GIT_COMMITTER_EMAIL).toBeUndefined()
  })

  it('does not leak arbitrary host env vars', () => {
    process.env.MY_SECRET_KEY = 'supersecret'
    process.env.DATABASE_URL = 'postgres://...'

    const env = buildAgentEnv(TASK, WORKSPACE)

    expect(env.MY_SECRET_KEY).toBeUndefined()
    expect(env.DATABASE_URL).toBeUndefined()
  })

  it('omits allowed vars that are not set on the host', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK

    const env = buildAgentEnv(TASK, WORKSPACE)

    expect('CLAUDE_CODE_USE_BEDROCK' in env).toBe(false)
  })
})
