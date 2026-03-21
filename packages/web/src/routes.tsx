import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router'
import { App } from './App'

const rootRoute = createRootRoute({ component: App })

const homeRoute = createRoute({
  component: lazyRouteComponent(() => import('@/pages/home'), 'HomePage'),
  getParentRoute: () => rootRoute,
  path: '/',
})

export const router = createRouter({
  defaultPreload: 'intent',
  routeTree: rootRoute.addChildren([homeRoute]),
})
