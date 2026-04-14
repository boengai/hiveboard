import { Outlet, useRouter, useRouterState } from '@tanstack/react-router'
import {
  AuthProvider,
  Avatar,
  ConnectionIndicator,
  RightFromBracketIcon,
  UsersIcon,
} from '@/components'
import { LoginPage } from '@/pages/login'
import { useAuthStore } from '@/store/authStore'

function HeaderUserMenu() {
  const user = useAuthStore((s) => s.user)
  const isLocal = useAuthStore((s) => s.isLocal)
  const logout = useAuthStore((s) => s.logout)
  const router = useRouter()

  if (!user) return null

  return (
    <div className="flex items-center gap-3">
      <ConnectionIndicator />
      {user.role === 'super-admin' && (
        <button
          className="rounded px-2 py-1 text-text-secondary hover:bg-surface-hover"
          onClick={() => router.navigate({ to: '/users' })}
          type="button"
        >
          <UsersIcon />
        </button>
      )}
      {!isLocal && (
        <button
          className="rounded px-2 py-1 text-text-secondary hover:bg-surface-hover"
          onClick={logout}
          type="button"
        >
          <RightFromBracketIcon />
        </button>
      )}
      <Avatar name={user.username} />
    </div>
  )
}

function AppLayout() {
  return (
    <div className="flex h-screen flex-col bg-surface-page">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-border-default border-b px-4">
        <div className="flex items-center gap-2">
          <a className="font-semibold text-body-sm text-honey-400" href="/">
            HiveBoard
          </a>
        </div>
        <HeaderUserMenu />
      </header>
      {/* Main */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}

export const App = () => {
  // Don't wrap auth callback route with AuthProvider
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  if (pathname === '/auth/callback') {
    return <AppLayout />
  }

  return (
    <AuthProvider loginPage={<LoginPage />}>
      <AppLayout />
    </AuthProvider>
  )
}
