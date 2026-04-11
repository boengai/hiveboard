import { useAuthStore } from '@/store/authStore'

const GITHUB_OAUTH_SCOPES = 'read:user user:email'

function getGitHubOAuthUrl(clientId: string, invitationToken?: string): string {
  const redirectUri = `${window.location.origin}/auth/callback`
  const state = invitationToken ?? ''
  return `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(GITHUB_OAUTH_SCOPES)}&state=${encodeURIComponent(state)}`
}

export function LoginPage() {
  const isLocal = useAuthStore((s) => s.isLocal)
  const isLoading = useAuthStore((s) => s.isLoading)

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

  // Get the OAuth client ID from the auth config (stored in auth store or fetched)
  const clientId =
    (window as unknown as { __HIVEBOARD_OAUTH_CLIENT_ID__?: string })
      .__HIVEBOARD_OAUTH_CLIENT_ID__ ?? ''

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

        {clientId ? (
          <a
            className="flex items-center gap-2 rounded-lg bg-gray-800 px-6 py-3 font-medium text-white transition-colors hover:bg-gray-700"
            href={getGitHubOAuthUrl(clientId, invitationToken)}
          >
            <svg
              aria-hidden="true"
              className="h-5 w-5"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                clipRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                fillRule="evenodd"
              />
            </svg>
            Sign in with GitHub
          </a>
        ) : (
          <p className="text-body-sm text-text-danger">
            GitHub OAuth is not configured. Contact the administrator.
          </p>
        )}
      </div>
    </div>
  )
}
