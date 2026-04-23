import { describe, expect, it } from 'bun:test'
import { loadPromptPartials } from '../src/agent/prompt-partials'

describe('prompt partials loader', () => {
  it('returns an object keyed by partial name (no .mustache suffix)', () => {
    const partials = loadPromptPartials()
    // After Task 5 these five keys exist; for Task 4 the loader may return {}.
    // The test only asserts the shape contract.
    expect(typeof partials).toBe('object')
    for (const [key, value] of Object.entries(partials)) {
      expect(key).not.toContain('.mustache')
      expect(typeof value).toBe('string')
    }
  })

  it('is called only once — subsequent calls return the same object identity (memoized)', () => {
    const a = loadPromptPartials()
    const b = loadPromptPartials()
    expect(a).toBe(b)
  })
})
