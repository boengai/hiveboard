import { createRouter, createRootRoute, createRoute, lazyRouteComponent } from '@tanstack/react-router'
import { App } from './App'

const rootRoute = createRootRoute({ component: App })

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(() => import('./pages/home'), 'HomePage'),
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute]),
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
