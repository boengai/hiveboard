import { describe, expect, it } from 'bun:test'
import { buildClaudeArgsForTest } from '../src/agent/runner'
import type { Config } from '../src/config/schema'

const CONFIG: Config = {
  agent: {
    max_concurrent_agents: 5,
    max_retry_backoff_ms: 300000,
    state_root: './tmp',
  },
  claude: {
    allowed_tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
    command: 'claude',
    max_turns: 200,
    model: 'opus',
    permission_mode: 'bypassPermissions',
  },
  hooks: { after_create: '' },
  polling: { interval_ms: 30_000 },
  progress: { enabled: true, snapshot_disk_budget_mb: 10, snapshot_interval_ms: 15_000 },
  tracker: { kind: 'github', owner: 'acme', project_number: 1 },
  verify: { commands: [], enabled: true, max_auto_revises: 1 },
  worker: { ssh_hosts: [] },
  workspace: { root: './tmp', ttl_ms: 259_200_000 },
} as unknown as Config

describe('buildClaudeArgs — allowed tools override', () => {
  it('uses config.claude.allowed_tools when no override passed', () => {
    const args = buildClaudeArgsForTest(CONFIG, 'prompt')
    const idx = args.indexOf('--allowedTools')
    expect(idx).toBeGreaterThan(-1)
    expect(args[idx + 1]).toBe('Bash,Read,Write,Edit,Glob,Grep')
  })

  it('replaces (not merges) config.claude.allowed_tools when override is non-empty', () => {
    const args = buildClaudeArgsForTest(CONFIG, 'prompt', ['Read', 'Grep'])
    const idx = args.indexOf('--allowedTools')
    expect(idx).toBeGreaterThan(-1)
    expect(args[idx + 1]).toBe('Read,Grep')
  })

  it('omits --allowedTools when override is an empty array AND config has no tools', () => {
    const noTools = { ...CONFIG, claude: { ...CONFIG.claude, allowed_tools: [] } } as Config
    const args = buildClaudeArgsForTest(noTools, 'prompt', [])
    expect(args.indexOf('--allowedTools')).toBe(-1)
  })
})
