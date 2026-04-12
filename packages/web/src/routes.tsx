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

const authCallbackRoute = createRoute({
  component: lazyRouteComponent(
    () => import('@/pages/auth/callback'),
    'AuthCallbackPage',
  ),
  getParentRoute: () => rootRoute,
  path: '/auth/callback',
})

const usersRoute = createRoute({
  component: lazyRouteComponent(() => import('@/pages/users'), 'UsersPage'),
  getParentRoute: () => rootRoute,
  path: '/users',
})

export const router = createRouter({
  defaultPreload: 'intent',
  routeTree: rootRoute.addChildren([homeRoute, authCallbackRoute, usersRoute]),
})
