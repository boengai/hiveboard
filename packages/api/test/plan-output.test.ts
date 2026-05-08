import { describe, expect, it } from 'bun:test'
import { extractPlanFromOutput } from '../src/orchestrator/plan-output'

describe('extractPlanFromOutput (post-split)', () => {
  it('returns parsed plan text for valid stream-json output', () => {
    const raw = JSON.stringify({ type: 'result', result: 'Plan body here.' })
    expect(extractPlanFromOutput(raw)).toBe('Plan body here.')
  })

  it('trims whitespace', () => {
    const raw = JSON.stringify({ type: 'result', result: '  Plan body.  \n\n' })
    expect(extractPlanFromOutput(raw)).toBe('Plan body.')
  })

  it('returns null on garbage CLI output (no plan recoverable)', () => {
    expect(extractPlanFromOutput('not json at all')).toBeNull()
  })

  it('returns null on empty plan text', () => {
    const raw = JSON.stringify({ type: 'result', result: '   ' })
    expect(extractPlanFromOutput(raw)).toBeNull()
  })
})
