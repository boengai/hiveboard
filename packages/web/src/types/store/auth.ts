export type AuthUser = {
  displayName: string
  githubId?: string | null
  githubUsername?: string | null
  id: string
  role: string
  username: string
}

export type AuthState = {
  isAuthenticated: boolean
  isLoading: boolean
  isLocal: boolean
  oauthClientId: string | null
  token: string | null
  user: AuthUser | null

  logout: () => void
  setIsLocal: (isLocal: boolean) => void
  setLoading: (loading: boolean) => void
  setOAuthClientId: (id: string) => void
  setToken: (token: string) => void
  setUser: (user: AuthUser) => void
}
