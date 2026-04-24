import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto'

const HKDF_INFO = Buffer.from('hiveboard:secrets:v1')
// RFC 5869 default salt: HashLen (32) zero bytes. Acceptable here because the IKM
// is already a 32-byte cryptographically random key; salt exists to strengthen
// low-entropy IKM (passphrases), which we do not accept.
const HKDF_SALT = Buffer.alloc(32)
const NONCE_BYTES = 12
const TAG_BYTES = 16
const KEK_BYTES = 32

export function deriveKek(rawBase64Key: string): Buffer {
  const raw = Buffer.from(rawBase64Key, 'base64')
  if (raw.length !== KEK_BYTES) {
    throw new Error(
      `HIVEBOARD_SECRETS_KEY must decode to exactly ${KEK_BYTES} bytes (got ${raw.length})`,
    )
  }
  const derived = hkdfSync('sha256', raw, HKDF_SALT, HKDF_INFO, KEK_BYTES)
  return Buffer.from(derived)
}

export function encrypt(kek: Buffer, plaintext: string): Buffer {
  if (kek.length !== KEK_BYTES) {
    throw new Error(`encrypt: expected ${KEK_BYTES}-byte key, got ${kek.length}`)
  }
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', kek, nonce)
  const ct = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return Buffer.concat([nonce, ct, tag])
}

export function decrypt(kek: Buffer, envelope: Buffer): string {
  if (kek.length !== KEK_BYTES) {
    throw new Error(`decrypt: expected ${KEK_BYTES}-byte key, got ${kek.length}`)
  }
  if (envelope.length < NONCE_BYTES + TAG_BYTES) {
    throw new Error('decrypt: envelope too short')
  }
  const nonce = envelope.subarray(0, NONCE_BYTES)
  const tag = envelope.subarray(envelope.length - TAG_BYTES)
  const ct = envelope.subarray(NONCE_BYTES, envelope.length - TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', kek, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
