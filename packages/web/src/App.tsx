import { Outlet } from '@tanstack/react-router'

export const App = () => (
  <div className="flex h-screen flex-col bg-surface-page">
    <Outlet />
  </div>
)
