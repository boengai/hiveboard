import { consola } from 'consola'
import { deriveKek } from './encryption'

let kek: Buffer | null = null
let testOverride: boolean | undefined = undefined

export type InitResult =
  | { enabled: true }
  | { enabled: false; reason: 'missing' | 'invalid'; message: string }

export function initSecretsFromEnv(
  env: Record<string, string | undefined> = process.env,
): InitResult {
  const raw = env.HIVEBOARD_SECRETS_KEY
  if (!raw) {
    kek = null
    const message =
      'HIVEBOARD_SECRETS_KEY is not set — per-task secrets feature is disabled. ' +
      'Generate one with: openssl rand -base64 32'
    consola.warn(message)
    return { enabled: false, reason: 'missing', message }
  }
  try {
    kek = deriveKek(raw)
    return { enabled: true }
  } catch (err) {
    kek = null
    // Do not forward the underlying error message: future refactors of deriveKek
    // could surface IKM bytes. Length/shape info is fine if it's our own message.
    const message = 'HIVEBOARD_SECRETS_KEY is invalid (must decode to exactly 32 bytes) — secrets feature disabled.'
    consola.warn(message)
    return { enabled: false, reason: 'invalid', message }
  }
}

export function secretsEnabled(): boolean {
  if (testOverride !== undefined) return testOverride
  return kek !== null
}

export function getKek(): Buffer | null {
  if (testOverride === false) return null
  return kek
}

/** Test-only. Pass undefined to restore real state. */
export function _setSecretsEnabledForTest(val: boolean | undefined): void {
  testOverride = val
}

/** Test-only. Seed a kek directly (e.g. inside an integration test). */
export function _setKekForTest(k: Buffer | null): void {
  kek = k
}
