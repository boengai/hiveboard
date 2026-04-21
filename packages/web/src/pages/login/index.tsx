import { useState } from 'react'
import { Button } from '@/components/common/button'
import { GitHubIcon } from '@/components/common/icon'
import { useAuthStore } from '@/store/authStore'

const GITHUB_OAUTH_SCOPES = 'read:user user:email'

const buildOAuthUrl = (clientId: string, state: string): string => {
  const redirectUri = `${window.location.origin}/auth/callback`
  return `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(GITHUB_OAUTH_SCOPES)}&state=${encodeURIComponent(state)}`
}

const LoginButton = ({ invitationToken }: { invitationToken?: string }) => {
  const { oauthClientId } = useAuthStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!oauthClientId) {
    return null
  }

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const qs = invitationToken
        ? `?invitation=${encodeURIComponent(invitationToken)}`
        : ''
      const res = await fetch(`/api/auth/github/start${qs}`, {
        credentials: 'include',
      })
      const data = (await res.json()) as { state?: string; error?: string }
      if (!res.ok || !data.state) {
        setError(data.error ?? 'Failed to start OAuth flow')
        setBusy(false)
        return
      }
      window.location.href = buildOAuthUrl(oauthClientId, data.state)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start OAuth')
      setBusy(false)
    }
  }

  return (
    <>
      <Button disabled={busy} onClick={start} size="large" type="button">
        <GitHubIcon />
        <span className="ml-2">
          {busy ? 'Redirecting...' : 'Sign in with GitHub'}
        </span>
      </Button>
      {error && <p className="text-body-sm text-text-danger">{error}</p>}
    </>
  )
}

export function LoginPage() {
  const { isLocal, isLoading, oauthClientId } = useAuthStore()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-page">
        <div className="text-text-secondary">Loading...</div>
      </div>
    )
  }

  // For local access, the auth context auto-authenticates — this page shouldn't be shown.
  // But just in case, show a message.
  if (isLocal) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-page">
        <div className="text-text-secondary">
          Authenticating as local admin...
        </div>
      </div>
    )
  }

  // Check for invitation token in URL
  const params = new URLSearchParams(window.location.search)
  const invitationToken = params.get('invitation') ?? undefined

  return (
    <div className="flex h-screen items-center justify-center bg-surface-page">
      <div className="flex flex-col items-center gap-6 rounded-xl border border-border-default bg-surface-raised p-8 shadow-lg">
        <div className="flex flex-col items-center gap-2">
          <span className="font-semibold text-2xl text-honey-400">
            HiveBoard
          </span>
          <p className="text-body-sm text-text-secondary">
            {invitationToken
              ? 'Accept your invitation to get started'
              : 'Sign in to continue'}
          </p>
        </div>

        {oauthClientId ? (
          <LoginButton invitationToken={invitationToken} />
        ) : (
          <p className="text-body-sm text-text-danger">
            GitHub OAuth is not configured. Contact the administrator.
          </p>
        )}
      </div>
    </div>
  )
}
