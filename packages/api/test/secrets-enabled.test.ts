import { afterEach, describe, expect, it } from 'bun:test'
import { randomBytes } from 'node:crypto'
import {
  _setKekForTest,
  _setSecretsEnabledForTest,
  getKek,
  initSecretsFromEnv,
  secretsEnabled,
} from '../src/secrets/enabled'

describe('secretsEnabled', () => {
  afterEach(() => {
    _setSecretsEnabledForTest(undefined)
    _setKekForTest(null)
  })

  it('defaults to false before init', () => {
    _setSecretsEnabledForTest(undefined)
    expect(secretsEnabled()).toBe(false)
    expect(getKek()).toBeNull()
  })

  it('initSecretsFromEnv returns false when env var missing', () => {
    const r = initSecretsFromEnv({ HIVEBOARD_SECRETS_KEY: undefined })
    expect(r.enabled).toBe(false)
    expect(r.reason).toBe('missing')
    expect(secretsEnabled()).toBe(false)
    expect(getKek()).toBeNull()
  })

  it('initSecretsFromEnv returns false when env var is invalid', () => {
    const r = initSecretsFromEnv({ HIVEBOARD_SECRETS_KEY: 'not-enough-bytes' })
    expect(r.enabled).toBe(false)
    expect(r.reason).toBe('invalid')
    expect(secretsEnabled()).toBe(false)
  })

  it('initSecretsFromEnv enables with a valid key', () => {
    const r = initSecretsFromEnv({
      HIVEBOARD_SECRETS_KEY: randomBytes(32).toString('base64'),
    })
    expect(r.enabled).toBe(true)
    expect(secretsEnabled()).toBe(true)
    expect(getKek()?.length).toBe(32)
  })

  it('_setSecretsEnabledForTest overrides state', () => {
    _setSecretsEnabledForTest(true)
    expect(secretsEnabled()).toBe(true)
    _setSecretsEnabledForTest(false)
    expect(secretsEnabled()).toBe(false)
    _setSecretsEnabledForTest(undefined)
    expect(secretsEnabled()).toBe(false)
  })

  it('getKek returns null when testOverride=false even if real kek is cached', () => {
    initSecretsFromEnv({ HIVEBOARD_SECRETS_KEY: randomBytes(32).toString('base64') })
    expect(getKek()).not.toBeNull()
    _setSecretsEnabledForTest(false)
    expect(getKek()).toBeNull()
    expect(secretsEnabled()).toBe(false)
  })

  it('reinit with unset env clears a previously cached kek', () => {
    initSecretsFromEnv({ HIVEBOARD_SECRETS_KEY: randomBytes(32).toString('base64') })
    expect(secretsEnabled()).toBe(true)
    initSecretsFromEnv({ HIVEBOARD_SECRETS_KEY: undefined })
    expect(secretsEnabled()).toBe(false)
    expect(getKek()).toBeNull()
  })
})
