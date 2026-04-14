import { useSearch } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useAuthStore } from '@/store/authStore'

export function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null)
  const setToken = useAuthStore((s) => s.setToken)
  const { code, state } = useSearch({ from: '/auth/callback' })

  useEffect(() => {
    if (!code) {
      setError('No authorization code received from GitHub')
      return
    }

    const body: Record<string, string> = { code }
    if (state) {
      body.invitationToken = state
    }

    fetch('/api/auth/github/callback', {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
      .then(async (res) => {
        const data = (await res.json()) as {
          sessionToken?: string
          error?: string
        }
        if (!res.ok || data.error) {
          setError(data.error ?? 'Authentication failed')
          return
        }
        if (data.sessionToken) {
          setToken(data.sessionToken)
          window.location.href = '/'
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Authentication failed')
      })
  }, [code, state, setToken])

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-page">
        <div className="flex flex-col items-center gap-4 rounded-xl border border-border-default bg-surface-raised p-8 shadow-lg">
          <p className="font-medium text-text-danger">{error}</p>
          <a
            className="text-body-sm text-honey-400 underline hover:no-underline"
            href="/"
          >
            Back to login
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center bg-surface-page">
      <div className="text-text-secondary">Completing authentication...</div>
    </div>
  )
}
