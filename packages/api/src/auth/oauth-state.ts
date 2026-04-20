/**
 * Server-side OAuth state binding.
 *
 * Prevents login-CSRF: the victim must hold the nonce we set before the
 * redirect, so an attacker's pre-captured code cannot be exchanged on the
 * victim's browser. The state we return to the caller is a random nonce;
 * the cookie stores the same nonce plus any invitation token, HMAC-signed
 * with a server secret so a client cannot forge a cookie that binds an
 * attacker-chosen invitation to an attacker-chosen state.
 */

const STATE_COOKIE = 'hb_oauth_state'
const STATE_TTL_SECONDS = 10 * 60 // 10 minutes

type DecodedState = {
  state: string
  invitationToken?: string
  issuedAt: number
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET ?? process.env.COOKIE_SECRET
  if (!secret || secret.length < 16) {
    throw new Error(
      'SESSION_SECRET must be set (min 16 chars) to sign OAuth state cookies.',
    )
  }
  return secret
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret()),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload),
  )
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

export async function generateOAuthState(
  invitationToken: string | undefined,
): Promise<{ state: string; cookieValue: string }> {
  const state = randomHex(32)
  const payload: DecodedState = {
    invitationToken,
    issuedAt: Date.now(),
    state,
  }
  const body = btoa(JSON.stringify(payload))
  const sig = await hmac(body)
  return { cookieValue: `${body}.${sig}`, state }
}

export async function verifyOAuthStateCookie(
  cookieValue: string,
): Promise<DecodedState | null> {
  const [body, sig] = cookieValue.split('.')
  if (!body || !sig) return null
  const expected = await hmac(body)
  if (!timingSafeEqual(sig, expected)) return null
  let decoded: DecodedState
  try {
    decoded = JSON.parse(atob(body)) as DecodedState
  } catch {
    return null
  }
  if (
    typeof decoded.state !== 'string' ||
    typeof decoded.issuedAt !== 'number'
  ) {
    return null
  }
  if (Date.now() - decoded.issuedAt > STATE_TTL_SECONDS * 1000) return null
  return decoded
}

export async function readOAuthStateCookie(
  cookieHeader: string | null,
): Promise<DecodedState | null> {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rest] = part.trim().split('=')
    if (rawName === STATE_COOKIE) {
      return verifyOAuthStateCookie(rest.join('='))
    }
  }
  return null
}

export function buildOAuthStateCookie(value: string): string {
  const attrs = [
    `${STATE_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${STATE_TTL_SECONDS}`,
  ]
  if (process.env.NODE_ENV === 'production') attrs.push('Secure')
  return attrs.join('; ')
}

export function clearOAuthStateCookieHeader(): string {
  const attrs = [
    `${STATE_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ]
  if (process.env.NODE_ENV === 'production') attrs.push('Secure')
  return attrs.join('; ')
}
