import { describe, expect, it } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { decrypt, deriveKek, encrypt } from '../src/secrets/encryption'

const RAW_KEY_B64 = randomBytes(32).toString('base64')

describe('deriveKek', () => {
  it('produces a 32-byte key', () => {
    const kek = deriveKek(RAW_KEY_B64)
    expect(kek.length).toBe(32)
  })

  it('is deterministic for the same input', () => {
    const a = deriveKek(RAW_KEY_B64)
    const b = deriveKek(RAW_KEY_B64)
    expect(a.equals(b)).toBe(true)
  })

  it('differs for different inputs', () => {
    const a = deriveKek(RAW_KEY_B64)
    const b = deriveKek(randomBytes(32).toString('base64'))
    expect(a.equals(b)).toBe(false)
  })

  it('rejects input of the wrong length (too short or too long)', () => {
    const tooShort = Buffer.alloc(16).toString('base64')
    const tooLong = Buffer.alloc(64).toString('base64')
    expect(() => deriveKek(tooShort)).toThrow()
    expect(() => deriveKek(tooLong)).toThrow()
  })
})

describe('encrypt / decrypt', () => {
  const kek = deriveKek(RAW_KEY_B64)

  it('round-trips UTF-8 strings', () => {
    const pt = 'postgres://user:password@host/db?schema=public'
    const env = encrypt(kek, pt)
    expect(env.length).toBeGreaterThan(12 + 16)
    expect(decrypt(kek, env)).toBe(pt)
  })

  it('handles empty-ish short strings', () => {
    const pt = 'a'
    expect(decrypt(kek, encrypt(kek, pt))).toBe(pt)
  })

  it('handles large values', () => {
    const pt = 'x'.repeat(10_000)
    expect(decrypt(kek, encrypt(kek, pt))).toBe(pt)
  })

  it('uses a fresh nonce per call (ciphertext differs for same plaintext)', () => {
    const pt = 'same'
    const a = encrypt(kek, pt)
    const b = encrypt(kek, pt)
    expect(a.equals(b)).toBe(false)
    expect(a.subarray(0, 12).equals(b.subarray(0, 12))).toBe(false)
  })

  it('fails to decrypt tampered ciphertext (AEAD)', () => {
    const env = encrypt(kek, 'secret')
    const tampered = Buffer.from(env)
    tampered[tampered.length - 1] ^= 0xff  // flip a bit in the auth tag
    expect(() => decrypt(kek, tampered)).toThrow()
  })

  it('fails to decrypt with wrong key', () => {
    const env = encrypt(kek, 'secret')
    const otherKek = deriveKek(randomBytes(32).toString('base64'))
    expect(() => decrypt(otherKek, env)).toThrow()
  })

  it('rejects envelope shorter than nonce+tag', () => {
    expect(() => decrypt(kek, Buffer.alloc(20))).toThrow()
  })

  it('decrypts the same envelope multiple times (stateless)', () => {
    const env = encrypt(kek, 'secret')
    expect(decrypt(kek, env)).toBe('secret')
    expect(decrypt(kek, env)).toBe('secret')
  })
})
