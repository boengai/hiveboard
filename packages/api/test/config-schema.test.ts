import { describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'
import { ConfigSchema } from '../src/config/schema'

describe('AgentSchema.state_root', () => {
  it('defaults to resolved ./tmp/agent-state', () => {
    const cfg = ConfigSchema.parse({})
    expect(cfg.agent.state_root).toBe(resolve('./tmp/agent-state'))
  })

  it('resolves a user-provided relative path', () => {
    const cfg = ConfigSchema.parse({ agent: { state_root: './custom/path' } })
    expect(cfg.agent.state_root).toBe(resolve('./custom/path'))
  })

  it('accepts an absolute path unchanged', () => {
    const cfg = ConfigSchema.parse({
      agent: { state_root: '/var/hiveboard/state' },
    })
    expect(cfg.agent.state_root).toBe('/var/hiveboard/state')
  })
})
