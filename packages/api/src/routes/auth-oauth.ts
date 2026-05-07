import { handleInvitationOAuth, handleLoginOAuth } from '../auth'
import {
  buildOAuthStateCookie,
  clearOAuthStateCookieHeader,
  generateOAuthState,
  readOAuthStateCookie,
} from '../auth/oauth-state'

export async function handleOAuthStart(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const invitationToken = url.searchParams.get('invitation') ?? undefined
  const { state, cookieValue } = await generateOAuthState(invitationToken)
  return Response.json(
    { state },
    { headers: { 'Set-Cookie': buildOAuthStateCookie(cookieValue) } },
  )
}

export async function handleOAuthCallback(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as {
      code?: string
      state?: string
    }
    if (!body.code) {
      return Response.json({ error: 'Missing code parameter' }, { status: 400 })
    }
    if (!body.state) {
      return Response.json(
        { error: 'Missing state parameter' },
        { status: 400 },
      )
    }

    const cookieHeader = req.headers.get('cookie')
    const storedState = await readOAuthStateCookie(cookieHeader)
    if (!storedState || storedState.state !== body.state) {
      return Response.json(
        { error: 'Invalid or expired OAuth state' },
        { status: 400 },
      )
    }

    const invitationToken = storedState.invitationToken
    const result = invitationToken
      ? await handleInvitationOAuth(body.code, invitationToken)
      : await handleLoginOAuth(body.code)

    return Response.json(result, {
      headers: { 'Set-Cookie': clearOAuthStateCookieHeader() },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OAuth callback failed'
    return Response.json(
      { error: message },
      {
        headers: { 'Set-Cookie': clearOAuthStateCookieHeader() },
        status: 400,
      },
    )
  }
}
