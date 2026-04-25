import { describe, expect, it } from 'bun:test'

import { decideOutcome } from '../src/orchestrator/outcomes/decide'

describe('decideOutcome — post-exit picker priority', () => {
  it('picks timeout when abortReason is TIMEOUT, even with question + success', () => {
    const out = decideOutcome({
      abortReason: 'TIMEOUT',
      question: 'mid-thought question',
      result: { success: true },
    })
    expect(out.kind).toBe('timeout')
  })

  it('picks question over a successful exit', () => {
    const out = decideOutcome({
      abortReason: undefined,
      question: 'should I do X?',
      result: { success: true },
    })
    expect(out).toEqual({ kind: 'question', question: 'should I do X?' })
  })

  it('picks question over a failed exit', () => {
    const out = decideOutcome({
      abortReason: undefined,
      question: 'pls help',
      result: { success: false },
    })
    expect(out.kind).toBe('question')
  })

  it('picks success on a clean zero-exit with no question', () => {
    const out = decideOutcome({
      abortReason: undefined,
      question: '',
      result: { success: true },
    })
    expect(out.kind).toBe('success')
  })

  it('picks failure on non-zero exit with no question', () => {
    const out = decideOutcome({
      abortReason: undefined,
      question: '',
      result: { success: false },
    })
    expect(out.kind).toBe('failure')
  })

  it('treats whitespace-only question as no question', () => {
    // `readQuestion` is responsible for trimming; this asserts the picker
    // contract: empty string ≡ no question.
    const out = decideOutcome({
      abortReason: undefined,
      question: '',
      result: { success: true },
    })
    expect(out.kind).toBe('success')
  })

  it('REDIRECT and CANCEL abort reasons fall through to natural exit', () => {
    expect(
      decideOutcome({
        abortReason: 'REDIRECT',
        question: '',
        result: { success: false },
      }).kind,
    ).toBe('failure')

    expect(
      decideOutcome({
        abortReason: 'CANCEL',
        question: '',
        result: { success: true },
      }).kind,
    ).toBe('success')
  })
})
