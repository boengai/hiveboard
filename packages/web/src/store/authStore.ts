import { create } from 'zustand'

type AuthUser = {
  id: string
  username: string
  displayName: string
  role: string
  githubId?: string | null
  githubUsername?: string | null
}

type AuthState = {
  user: AuthUser | null
  token: string | null
  isLocal: boolean
  isLoading: boolean
  isAuthenticated: boolean

  setUser: (user: AuthUser) => void
  setToken: (token: string) => void
  setIsLocal: (isLocal: boolean) => void
  setLoading: (loading: boolean) => void
  logout: () => void
}

const STORAGE_KEY = 'hiveboard_access_token'

function getStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  isLoading: true,
  isLocal: false,

  logout: () => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
    set({ isAuthenticated: false, token: null, user: null })
  },

  setIsLocal: (isLocal: boolean) => set({ isLocal }),

  setLoading: (isLoading: boolean) => set({ isLoading }),

  setToken: (token: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, token)
    } catch {
      // ignore
    }
    set({ token })
  },

  setUser: (user: AuthUser) =>
    set({ isAuthenticated: true, isLoading: false, user }),
  token: getStoredToken(),
  user: null,
}))
