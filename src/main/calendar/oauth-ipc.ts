// The IPC of the Microsoft 365 and Google accounts (plan phase 2e): which OAuth client is used, the
// browser sign-in that ends in the add dialog's pick of calendars (a draft, as for CalDAV), Cancel,
// and "Sign in again" for a connection whose token the provider no longer takes. The tokens stay in
// the main process; a window only ever gets the draft (names and the account's address).

import { app, shell } from 'electron'
import { handleTrusted } from '../secure-ipc'
import { getMainWindow } from '../quick-entry-state'
import { isMac } from '../platform'
import { BrowserSignInCancelledError } from '../auth/loopback-callback'
import {
  CALENDAR_ACCOUNT_PROVIDERS,
  isCalendarAccountProvider,
  type CalendarAccountProvider,
  type OwnOAuthClientInput,
} from '../../shared/calendar-accounts'
import type { CaldavDraft, CalendarSourcesView } from '../../shared/calendar-sources'
import { CalendarReadError } from './http'
import { allowTestEndpoints, browserSignIn, providerEndpoints, type OAuthClient, type TokenSet } from './oauth'
import { clientFor, oauthClientsView, setOwnClient } from './oauth-clients'
import type { OAuthAccountConfig } from './sources/oauth-account'
import type { CalendarSource, ConnectResult, SourceContext } from './sources/types'
import type { StoredConnection } from './store'

/** What the service lends the account IPC. */
export interface OAuthIpcDeps {
  ctx: SourceContext
  sources: Record<CalendarAccountProvider, CalendarSource<OAuthAccountConfig>>
  /** Keep a signed-in account for the add dialog's pick. */
  saveDraft(kind: CalendarAccountProvider, result: ConnectResult<OAuthAccountConfig>): CaldavDraft
  connection(id: string): StoredConnection | undefined
  configOf(connection: StoredConnection): Promise<unknown | null>
  /** Replace a connection's config (new tokens) and read it again. */
  replaceConfig(connectionId: string, config: OAuthAccountConfig): Promise<void>
  messageOf(error: unknown): string
  view(): Promise<CalendarSourcesView>
}

/** Said when the user cancelled the sign-in: the dialog shows nothing for it. */
export const SIGN_IN_CANCELLED = 'The sign-in was cancelled.'

let active: AbortController | null = null

function cancelSignIn(): void {
  active?.abort()
  active = null
}

function bringVicuForward(): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  if (isMac) app.focus({ steal: true })
  win.focus()
}

function noClient(provider: CalendarAccountProvider): CalendarReadError {
  return new CalendarReadError(`This version of Vicu has no ${CALENDAR_ACCOUNT_PROVIDERS[provider].label} sign-in registered yet. Use your own OAuth client.`, 'auth')
}

async function signIn(provider: CalendarAccountProvider, client: OAuthClient, ctx: SourceContext): Promise<TokenSet> {
  if (!ctx.signInFetch) throw new CalendarReadError('Vicu could not start the sign-in on this computer.', 'other')
  cancelSignIn()
  const controller = new AbortController()
  active = controller
  try {
    return await browserSignIn({
      provider,
      client,
      endpoints: providerEndpoints(provider),
      open: (url) => shell.openExternal(url),
      fetch: ctx.signInFetch,
      now: ctx.now,
      signal: controller.signal,
      onReturned: bringVicuForward,
    })
  } finally {
    if (active === controller) active = null
  }
}

function failure(error: unknown, deps: OAuthIpcDeps): { success: false; error: string } {
  if (error instanceof BrowserSignInCancelledError) return { success: false, error: SIGN_IN_CANCELLED }
  return { success: false, error: deps.messageOf(error) }
}

export function registerCalendarOAuthIpc(deps: OAuthIpcDeps): void {
  // Test endpoints (VICU_TEST_CALENDAR_ENDPOINTS) are read only in an unpackaged build.
  allowTestEndpoints(!app.isPackaged)

  handleTrusted('calendar:oauth-clients', () => oauthClientsView())

  handleTrusted('calendar:oauth-set-client', async (_event, provider: unknown, input: OwnOAuthClientInput | null) => {
    if (!isCalendarAccountProvider(provider)) return { success: false, error: 'Unknown account type.' }
    try {
      await setOwnClient(provider, input === null ? null : { clientId: String(input?.clientId ?? ''), clientSecret: input?.clientSecret === undefined ? undefined : String(input.clientSecret) })
      return { success: true, data: await oauthClientsView() }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'The client could not be saved.' }
    }
  })

  handleTrusted('calendar:oauth-sign-in', async (_event, provider: unknown) => {
    if (!isCalendarAccountProvider(provider)) return { success: false, error: 'Unknown account type.' }
    try {
      const client = await clientFor(provider)
      if (!client) throw noClient(provider)
      const tokens = await signIn(provider, client, deps.ctx)
      const result = await deps.sources[provider].connect({ tokens, client }, deps.ctx)
      return { success: true, data: deps.saveDraft(provider, result) }
    } catch (error) {
      return failure(error, deps)
    }
  })

  handleTrusted('calendar:oauth-cancel', () => {
    cancelSignIn()
  })

  handleTrusted('calendar:oauth-reconnect', async (_event, connectionId: unknown) => {
    const connection = deps.connection(String(connectionId))
    if (!connection || !isCalendarAccountProvider(connection.kind)) return { success: false, error: 'This account is no longer connected.' }
    const provider = connection.kind
    try {
      const old = (await deps.configOf(connection)) as OAuthAccountConfig | null
      // The client the connection signed in with, so its calendars stay the same app's.
      const client = old?.client ?? (await clientFor(provider))
      if (!client) throw noClient(provider)
      const tokens = await signIn(provider, client, deps.ctx)
      const result = await deps.sources[provider].connect({ tokens, client }, deps.ctx)
      if (old && old.account.id && result.config.account.id !== old.account.id) {
        throw new CalendarReadError(`That is a different account. Sign in as ${old.account.email}.`, 'auth')
      }
      await deps.replaceConfig(connection.id, result.config)
      return { success: true, data: await deps.view() }
    } catch (error) {
      return failure(error, deps)
    }
  })
}
