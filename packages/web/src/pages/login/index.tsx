import { GitHubIcon } from '@/components/common/icon'
import { useAuthStore } from '@/store/authStore'

const GITHUB_OAUTH_SCOPES = 'read:user user:email'

const getGitHubOAuthUrl = (
  clientId: string,
  invitationToken?: string,
): string => {
  const redirectUri = `${window.location.origin}/auth/callback`
  const state = invitationToken ?? ''
  return `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(GITHUB_OAUTH_SCOPES)}&state=${encodeURIComponent(state)}`
}

const LoginButton = () => {
  const { oauthClientId } = useAuthStore()

  if (!oauthClientId) {
    return null
  }

  return (
    <a
      className="flex items-center gap-2 rounded-lg bg-gray-800 px-6 py-3 font-medium text-white transition-colors hover:bg-gray-700"
      href={getGitHubOAuthUrl(oauthClientId)}
    >
      <GitHubIcon />
      Sign in with GitHub
    </a>
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
            {invitationToken ? (
              'Accept your invitation to get started'
            ) : (
              <LoginButton />
            )}
          </p>
        </div>

        {oauthClientId ? (
          <LoginButton />
        ) : (
          <p className="text-body-sm text-text-danger">
            GitHub OAuth is not configured. Contact the administrator.
          </p>
        )}
      </div>
    </div>
  )
}
