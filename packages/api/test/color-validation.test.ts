import { describe, expect, test } from 'bun:test'
import { HexColorSchema } from '../src/schema/validation'

describe('HexColorSchema', () => {
  const valid = ['#e53e3e', '#AAAAAA', '#000000', '#ffffff', '#1a2B3c']

  for (const color of valid) {
    test(`accepts valid hex color: ${color}`, () => {
      expect(HexColorSchema.parse(color)).toBe(color)
    })
  }

  const invalid = [
    { input: 'e53e3e', reason: 'missing #' },
    { input: '#GGG000', reason: 'invalid hex characters' },
    { input: '#12', reason: 'too short' },
    { input: '#1234567', reason: 'too long' },
    { input: 'red', reason: 'color name' },
    { input: '', reason: 'empty string' },
    { input: '#abc', reason: '3-digit hex' },
  ]

  for (const { input, reason } of invalid) {
    test(`rejects invalid color (${reason}): "${input}"`, () => {
      expect(() => HexColorSchema.parse(input)).toThrow()
    })
  }
})
