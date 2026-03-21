import { Outlet } from '@tanstack/react-router'
import { Avatar, ConnectionIndicator } from '@/components'

export const App = () => (
  <div className="flex h-screen flex-col bg-surface-page">
    {/* Header */}
    <header className="flex h-12 shrink-0 items-center justify-between border-border-default border-b px-4">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-body-sm text-honey-400">
          HiveBoard
        </span>
      </div>
      <div className="flex items-center gap-3">
        <ConnectionIndicator />
        <Avatar name="queen-bee" />
      </div>
    </header>
    {/* Main */}
    <main className="flex-1 overflow-hidden">
      <Outlet />
    </main>
  </div>
)
