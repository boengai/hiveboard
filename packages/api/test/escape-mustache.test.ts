/**
 * escape-mustache.test.ts
 *
 * Tests for escapeMustacheSyntax — ensures that untrusted content from
 * GitHub PR review comments cannot inject Mustache tags or JS template
 * expressions into the agent prompt.
 */

import { describe, expect, it } from 'bun:test'
import { escapeMustacheSyntax } from '../src/orchestrator/orchestrator'

describe('escapeMustacheSyntax', () => {
  it('escapes Mustache opening delimiters', () => {
    expect(escapeMustacheSyntax('{{variable}}')).toBe('{ {variable} }')
  })

  it('escapes Mustache closing delimiters', () => {
    expect(escapeMustacheSyntax('hello}} world')).toBe('hello} } world')
  })

  it('escapes JS template literal expressions', () => {
    // Use concatenation to avoid noTemplateCurlyInString lint warning
    expect(escapeMustacheSyntax('$' + '{process.env.SECRET}')).toBe(
      '$ {process.env.SECRET}',
    )
  })

  it('escapes all patterns in a single string', () => {
    const input = 'Use {{#section}}$' + '{env.VAR}{{/section}} here'
    const result = escapeMustacheSyntax(input)
    expect(result).not.toContain('{{')
    expect(result).not.toContain('}}')
    expect(result).not.toContain('${')
  })

  it('leaves safe text unchanged', () => {
    const safe = 'This is a normal review comment with no special syntax.'
    expect(escapeMustacheSyntax(safe)).toBe(safe)
  })

  it('handles multiple occurrences', () => {
    const input = '{{a}} and {{b}} plus $' + '{c} and $' + '{d}'
    const result = escapeMustacheSyntax(input)
    expect(result).toBe('{ {a} } and { {b} } plus $ {c} and $ {d}')
  })

  it('handles empty string', () => {
    expect(escapeMustacheSyntax('')).toBe('')
  })

  it('handles triple mustache (unescaped output syntax)', () => {
    const input = '{{{raw_html}}}'
    const result = escapeMustacheSyntax(input)
    expect(result).not.toContain('{{')
    expect(result).not.toContain('}}')
  })

  it('does not alter single braces', () => {
    const input = 'const obj = { key: value }'
    expect(escapeMustacheSyntax(input)).toBe(input)
  })
})
