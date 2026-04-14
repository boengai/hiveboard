import type { AuthState, AuthUser } from '@/types'
import { create } from 'zustand'

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
  oauthClientId: null,

  setIsLocal: (isLocal: boolean) => set({ isLocal }),

  setLoading: (isLoading: boolean) => set({ isLoading }),

  setOAuthClientId: (oauthClientId: string) => set({ oauthClientId }),

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
