import { type ReactNode, useEffect } from 'react'
import { graphqlClient } from '@/graphql/client'
import { GET_AUTH_CONFIG, GET_ME } from '@/graphql/queries'
import { useAuthStore } from '@/store/authStore'

type AuthProviderProps = {
  children: ReactNode
  loginPage: ReactNode
}

export function AuthProvider({ children, loginPage }: AuthProviderProps) {
  const {
    isAuthenticated,
    isLoading,
    setUser,
    setIsLocal,
    setLoading,
    logout,
  } = useAuthStore()

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        // First check auth config to determine if local
        const configData = await graphqlClient.request<{
          authConfig: {
            githubOAuthClientId: string | null
            isLocal: boolean
          }
        }>(GET_AUTH_CONFIG)

        if (cancelled) return

        setIsLocal(configData.authConfig.isLocal)

        // Store OAuth client ID for the login page
        if (configData.authConfig.githubOAuthClientId) {
          ;(
            window as unknown as { __HIVEBOARD_OAUTH_CLIENT_ID__?: string }
          ).__HIVEBOARD_OAUTH_CLIENT_ID__ =
            configData.authConfig.githubOAuthClientId
        }

        // Try to fetch current user (will work for local access or valid token)
        const meData = await graphqlClient.request<{
          me: {
            id: string
            username: string
            displayName: string
            role: string
            githubId?: string | null
            githubUsername?: string | null
          }
        }>(GET_ME)

        if (cancelled) return

        setUser(meData.me)
      } catch {
        if (cancelled) return
        // Authentication failed — show login
        logout()
        setLoading(false)
      }
    }

    init()
    return () => {
      cancelled = true
    }
  }, [setUser, setIsLocal, setLoading, logout])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-page">
        <div className="text-text-secondary">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <>{loginPage}</>
  }

  return <>{children}</>
}
