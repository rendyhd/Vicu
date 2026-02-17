import {
  createRouter,
  createRootRoute,
  createRoute,
  createHashHistory,
} from '@tanstack/react-router'
import { AppShell } from '@/components/layout/AppShell'
import { InboxView } from '@/views/InboxView'
import { TodayView } from '@/views/TodayView'
import { UpcomingView } from '@/views/UpcomingView'
import { AnytimeView } from '@/views/AnytimeView'
import { LogbookView } from '@/views/LogbookView'
import { ProjectView } from '@/views/ProjectView'
import { TagView } from '@/views/TagView'
import { SettingsView } from '@/views/SettingsView'
import { CustomListView } from '@/views/CustomListView'
import { SearchView } from '@/views/SearchView'

const rootRoute = createRootRoute({
  component: AppShell,
})

// Index route redirects to inbox
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: InboxView,
})

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inbox',
  component: InboxView,
})

const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/today',
  component: TodayView,
})

const upcomingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/upcoming',
  component: UpcomingView,
})

const anytimeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/anytime',
  component: AnytimeView,
})

const logbookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logbook',
  component: LogbookView,
})

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/project/$projectId',
  component: ProjectView,
})

const tagRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tag/$labelId',
  component: TagView,
})

const customListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/list/$listId',
  component: CustomListView,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsView,
})

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  component: SearchView,
  validateSearch: (search: Record<string, unknown>) => ({
    q: (search.q as string) || '',
  }),
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  inboxRoute,
  todayRoute,
  upcomingRoute,
  anytimeRoute,
  logbookRoute,
  projectRoute,
  tagRoute,
  customListRoute,
  settingsRoute,
  searchRoute,
])

// Use hash history for Electron compatibility (file:// URLs don't support browser history)
const hashHistory = createHashHistory()

export const router = createRouter({
  routeTree,
  history: hashHistory,
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
