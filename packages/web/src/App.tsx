import { Outlet, useRouter, useRouterState } from '@tanstack/react-router'
import { Avatar } from '@/components/common/avatar' // reduce the bundle size
import { Button } from '@/components/common/button' // reduce the bundle size
import { ConnectionIndicator } from '@/components/common/connection-indicator' // reduce the bundle size
import { BookTextIcon, LogOutIcon, UsersIcon } from '@/components/common/icon' // reduce the bundle size
import { AuthProvider } from '@/components/provider/AuthProvider' // reduce the bundle size
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
      <Button
        aria-label="Playbooks"
        onClick={() => router.navigate({ to: '/playbooks' })}
        size="icon"
        title="Playbooks"
        type="button"
        variant="ghost"
      >
        <BookTextIcon />
      </Button>
      {user.role === 'super-admin' && (
        <Button
          aria-label="Users"
          onClick={() => router.navigate({ to: '/users' })}
          size="icon"
          title="Users"
          type="button"
          variant="ghost"
        >
          <UsersIcon />
        </Button>
      )}
      {!isLocal && (
        <Button
          aria-label="Log out"
          onClick={logout}
          size="icon"
          title="Log out"
          type="button"
          variant="ghost"
        >
          <LogOutIcon />
        </Button>
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
          <span aria-hidden className="text-honey-300">▌</span>
          <a
            className="font-semibold text-body-sm text-honey-300 uppercase tracking-[0.18em]"
            href="/"
          >
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
