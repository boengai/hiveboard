import { describe, expect, it } from 'bun:test'
import { scrubSecrets } from '../src/secrets/scrubber'
import { buildScrubPairs } from '../src/agent/runner'

describe('buildScrubPairs', () => {
  it('builds pairs from secretsEnv with the env var name as label', () => {
    const pairs = buildScrubPairs({ DATABASE_URL: 'pg://secret123' })
    expect(pairs).toEqual([{ name: 'DATABASE_URL', value: 'pg://secret123' }])
  })

  it('builds pairs from secretValues with REDACTED as label', () => {
    const pairs = buildScrubPairs(undefined, ['plain-secret'])
    expect(pairs).toEqual([{ name: 'REDACTED', value: 'plain-secret' }])
  })

  it('deduplicates values that appear in both secretsEnv and secretValues', () => {
    // Same value in both: secretsEnv wins (processed first), secretValues entry is skipped
    const pairs = buildScrubPairs(
      { DATABASE_URL: 'pg://secret123' },
      ['pg://secret123', 'other-secret'],
    )
    expect(pairs).toHaveLength(2)
    expect(pairs[0]).toEqual({ name: 'DATABASE_URL', value: 'pg://secret123' })
    expect(pairs[1]).toEqual({ name: 'REDACTED', value: 'other-secret' })
  })

  it('skips empty string values', () => {
    const pairs = buildScrubPairs({ EMPTY: '' }, [''])
    expect(pairs).toHaveLength(0)
  })

  it('returns empty array when both inputs are absent', () => {
    expect(buildScrubPairs()).toEqual([])
    expect(buildScrubPairs(undefined, undefined)).toEqual([])
  })
})

describe('runner secrets integration', () => {
  it('scrubber replaces a known value with [redacted:NAME]', () => {
    const pairs = [{ name: 'DATABASE_URL', value: 'pg://secret123' }]
    const out = scrubSecrets('DB leaked: pg://secret123 END', pairs)
    expect(out).toBe('DB leaked: [redacted:DATABASE_URL] END')
  })

  it('scrubber replaces a REDACTED value with [redacted:REDACTED]', () => {
    const pairs = [{ name: 'REDACTED', value: 'plain-secret' }]
    const out = scrubSecrets('leaked: plain-secret here', pairs)
    expect(out).toBe('leaked: [redacted:REDACTED] here')
  })

  it('full plumbing: buildScrubPairs → scrubSecrets scrubs output correctly', () => {
    const secretsEnv = { DATABASE_URL: 'pg://secret123' }
    const secretValues = ['extra-token-xyz']
    const rawOutput = 'connecting to pg://secret123 with token extra-token-xyz done'

    const pairs = buildScrubPairs(secretsEnv, secretValues)
    const scrubbed = scrubSecrets(rawOutput, pairs)

    expect(scrubbed).not.toContain('pg://secret123')
    expect(scrubbed).not.toContain('extra-token-xyz')
    expect(scrubbed).toContain('[redacted:DATABASE_URL]')
    expect(scrubbed).toContain('[redacted:REDACTED]')
  })

  it('scrubber handles output with no secrets unchanged', () => {
    const pairs = buildScrubPairs({ API_KEY: 'super-secret' })
    const out = scrubSecrets('no secrets here', pairs)
    expect(out).toBe('no secrets here')
  })

  it('multiple occurrences of the same secret are all replaced', () => {
    const pairs = buildScrubPairs({ TOKEN: 'abc123' })
    const out = scrubSecrets('abc123 and again abc123 end', pairs)
    expect(out).toBe('[redacted:TOKEN] and again [redacted:TOKEN] end')
  })
})
