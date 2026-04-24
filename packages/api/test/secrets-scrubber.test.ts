import { describe, expect, it } from 'bun:test'
import { scrubSecrets } from '../src/secrets/scrubber'

describe('scrubSecrets', () => {
  it('returns input unchanged when no pairs', () => {
    expect(scrubSecrets('hello', [])).toBe('hello')
  })

  it('returns empty string unchanged even with pairs', () => {
    expect(scrubSecrets('', [{ name: 'X', value: 'y' }])).toBe('')
  })

  it('replaces a single literal value', () => {
    const out = scrubSecrets('DB=pg://host', [{ name: 'DB', value: 'pg://host' }])
    expect(out).toBe('DB=[redacted:DB]')
  })

  it('replaces multiple distinct values', () => {
    const out = scrubSecrets(
      'DB=pg; KEY=abc123',
      [
        { name: 'DB', value: 'pg' },
        { name: 'KEY', value: 'abc123' },
      ],
    )
    expect(out).toBe('DB=[redacted:DB]; KEY=[redacted:KEY]')
  })

  it('replaces ALL occurrences (not just the first)', () => {
    const out = scrubSecrets('x=secret y=secret z=secret', [{ name: 'X', value: 'secret' }])
    expect(out).toBe('x=[redacted:X] y=[redacted:X] z=[redacted:X]')
  })

  it('escapes regex metacharacters in values', () => {
    const value = 'a+b.c*d?e^f${g}h|i(j)k[l]m'
    const out = scrubSecrets(`Leak: ${value} end`, [{ name: 'META', value }])
    expect(out).toBe('Leak: [redacted:META] end')
  })

  it('prefers longer match when one value is a prefix of another', () => {
    const out = scrubSecrets(
      'secret-long and secret',
      [
        { name: 'SHORT', value: 'secret' },
        { name: 'LONG', value: 'secret-long' },
      ],
    )
    expect(out).toBe('[redacted:LONG] and [redacted:SHORT]')
  })

  it('skips empty-string values', () => {
    const out = scrubSecrets('hello', [{ name: 'EMPTY', value: '' }])
    expect(out).toBe('hello')
  })

  it('handles very large output with many values in bounded time', () => {
    const values = Array.from({ length: 20 }, (_, i) => ({
      name: `S${i}`,
      value: `super-secret-${i}-${'x'.repeat(30)}`,
    }))
    let text = 'x'.repeat(1_000_000)
    for (const v of values) {
      const offset = Math.floor((Math.random() * (text.length - v.value.length - 1)))
      text = text.slice(0, offset) + v.value + text.slice(offset + v.value.length)
    }
    const start = Date.now()
    const out = scrubSecrets(text, values)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(2000)
    for (const v of values) {
      expect(out).not.toContain(v.value)
      expect(out).toContain(`[redacted:${v.name}]`)
    }
  })
})
