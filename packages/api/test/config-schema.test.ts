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

describe('ProgressSchema', () => {
  it('defaults to enabled=true, 15 s interval, 10 MB budget', () => {
    const cfg = ConfigSchema.parse({})
    expect(cfg.progress.enabled).toBe(true)
    expect(cfg.progress.snapshot_interval_ms).toBe(15_000)
    expect(cfg.progress.snapshot_disk_budget_mb).toBe(10)
  })

  it('accepts user overrides', () => {
    const cfg = ConfigSchema.parse({
      progress: {
        enabled: false,
        snapshot_disk_budget_mb: 25,
        snapshot_interval_ms: 30_000,
      },
    })
    expect(cfg.progress).toEqual({
      enabled: false,
      snapshot_disk_budget_mb: 25,
      snapshot_interval_ms: 30_000,
    })
  })

  it('rejects non-positive intervals', () => {
    expect(() =>
      ConfigSchema.parse({ progress: { snapshot_interval_ms: 0 } }),
    ).toThrow()
  })
})

describe('SchedulerSchema', () => {
  it('defaults legacy_mode to false', () => {
    const cfg = ConfigSchema.parse({})
    expect(cfg.scheduler.legacy_mode).toBe(false)
  })
  it('accepts legacy_mode=true', () => {
    const cfg = ConfigSchema.parse({ scheduler: { legacy_mode: true } })
    expect(cfg.scheduler.legacy_mode).toBe(true)
  })
})
