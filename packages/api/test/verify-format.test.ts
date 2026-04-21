import { describe, expect, it } from 'bun:test'
import { formatVerificationFailureForAgent } from '../src/orchestrator/verify'

const FAIL_RUN = {
  command: 'bun run test',
  exit_code: 1,
  finished_at: '2026-04-21T14:32:05Z',
  label: 'test',
  output: 'FAIL packages/api/test/foo.test.ts\n  expected 1 got 2',
  started_at: '2026-04-21T14:32:00Z',
}

describe('formatVerificationFailureForAgent', () => {
  it('produces a messages-array shape for Mustache rendering', () => {
    const ctx = formatVerificationFailureForAgent([FAIL_RUN])
    expect(Array.isArray(ctx.verification_failures)).toBe(true)
    expect(ctx.verification_failures).toHaveLength(1)
    expect(ctx.verification_failures[0].label).toBe('test')
    expect(ctx.verification_failures[0].exit_code).toBe(1)
    expect(ctx.verification_failures[0].command).toBe('bun run test')
    expect(ctx.verification_failures[0].output).toContain('FAIL packages/api')
  })

  it('escapes Mustache tags inside output so {{ }} cannot inject', () => {
    const trick = {
      ...FAIL_RUN,
      output: 'explode: {{bad}} and {{{worse}}}',
    }
    const ctx = formatVerificationFailureForAgent([trick])
    expect(ctx.verification_failures[0].output).not.toContain('{{bad}}')
    expect(ctx.verification_failures[0].output).not.toContain('{{{worse}}}')
    expect(ctx.verification_failures[0].output).toContain('bad')
    expect(ctx.verification_failures[0].output).toContain('worse')
  })

  it('returns empty array when given no failures', () => {
    const ctx = formatVerificationFailureForAgent([])
    expect(ctx.verification_failures).toEqual([])
  })
})
