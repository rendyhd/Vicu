import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CalendarAccountProvider, OAuthClientsView, OwnOAuthClientInput } from '../../shared/calendar-accounts'
import type { CalendarSourcesView } from '../../shared/calendar-sources'
import { CALENDAR_SOURCES_KEY, invalidateCalendars } from './use-calendar-events'

// Microsoft 365 and Google calendar accounts (plan phase 2e): which OAuth client signs in, the
// browser sign-in that gives a draft to pick calendars from, and "Sign in again". The tokens and the
// client secret stay in the main process.

export const OAUTH_CLIENTS_KEY = 'calendar-oauth-clients'

/** Said by main when the user cancelled: not an error to show (oauth-ipc.ts SIGN_IN_CANCELLED). */
export const SIGN_IN_CANCELLED = 'The sign-in was cancelled.'

export function useOAuthClients() {
  return useQuery<OAuthClientsView>({
    queryKey: [OAUTH_CLIENTS_KEY],
    queryFn: () => window.api.calendar.oauthClients(),
    // One IPC call to main: asked again whenever a form opens.
    staleTime: 0,
  })
}

export function useCalendarAccountActions() {
  const client = useQueryClient()
  const setClient = useMutation({
    mutationFn: async ({ provider, input }: { provider: CalendarAccountProvider; input: OwnOAuthClientInput | null }) => {
      const result = await window.api.calendar.oauthSetClient(provider, input)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSuccess: (view) => client.setQueryData([OAUTH_CLIENTS_KEY], view),
    meta: { silent: true },
  })
  const signIn = useMutation({
    mutationFn: async (provider: CalendarAccountProvider) => {
      const result = await window.api.calendar.oauthSignIn(provider)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    meta: { silent: true },
  })
  const reconnect = useMutation({
    mutationFn: async (connectionId: string) => {
      const result = await window.api.calendar.oauthReconnect(connectionId)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSuccess: (view: CalendarSourcesView) => {
      client.setQueryData([CALENDAR_SOURCES_KEY], view)
      invalidateCalendars(client)
    },
    meta: { silent: true },
  })
  return { setClient, signIn, reconnect, cancel: () => void window.api.calendar.oauthCancel() }
}

/** An error worth showing: anything but the user's own Cancel. */
export function shownError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : null
  return message && message !== SIGN_IN_CANCELLED ? message : null
}
