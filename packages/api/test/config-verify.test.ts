import { describe, expect, it } from 'bun:test'
import { ConfigSchema } from '../src/config/schema'

describe('VerifySchema', () => {
  it('defaults to enabled=true, empty commands, max_auto_revises=1', () => {
    const cfg = ConfigSchema.parse({})
    expect(cfg.verify.enabled).toBe(true)
    expect(cfg.verify.commands).toEqual([])
    expect(cfg.verify.max_auto_revises).toBe(1)
  })

  it('accepts a full commands array', () => {
    const cfg = ConfigSchema.parse({
      verify: {
        commands: [
          { label: 'lint', run: 'bun run lint', timeout_ms: 120_000 },
          { label: 'test', run: 'bun run test', timeout_ms: 300_000 },
        ],
      },
    })
    expect(cfg.verify.commands).toHaveLength(2)
    expect(cfg.verify.commands[0].label).toBe('lint')
    expect(cfg.verify.commands[0].run).toBe('bun run lint')
    expect(cfg.verify.commands[0].timeout_ms).toBe(120_000)
  })

  it('timeout_ms defaults to 300000 when omitted', () => {
    const cfg = ConfigSchema.parse({
      verify: { commands: [{ label: 'test', run: 'bun run test' }] },
    })
    expect(cfg.verify.commands[0].timeout_ms).toBe(300_000)
  })

  it('rejects non-positive max_auto_revises', () => {
    expect(() =>
      ConfigSchema.parse({ verify: { max_auto_revises: -1 } }),
    ).toThrow()
  })

  it('accepts max_auto_revises=0 to disable retries while keeping verification', () => {
    const cfg = ConfigSchema.parse({ verify: { max_auto_revises: 0 } })
    expect(cfg.verify.max_auto_revises).toBe(0)
  })
})
