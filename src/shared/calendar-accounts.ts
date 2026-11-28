// Microsoft 365 and Google calendar accounts (contract 20.9, docs/calendar-plan.md phase 2e), the
// shapes the windows and the main process share. Read-only: Vicu asks each provider for the smallest
// read scope it has, signs in through the system browser (loopback redirect, PKCE) and keeps the
// tokens sealed on this device. No token, client secret or address ever crosses to a window.
// Pure: no Electron, no DOM.

export type CalendarAccountProvider = 'microsoft' | 'google'

export interface CalendarAccountProviderInfo {
  id: CalendarAccountProvider
  /** The connection's name, and the add dialog's choice. */
  label: string
  /** One line under the choice in the add dialog. */
  summary: string
  /** What Vicu is allowed to do, in the provider's own words. */
  permission: string
  /** Google's Desktop clients have a secret (which Google documents as not secret); Microsoft's have none. */
  needsSecret: boolean
  /** How the provider's own client id looks, for the form's placeholder. */
  clientIdHint: string
}

export const CALENDAR_ACCOUNT_PROVIDERS: Record<CalendarAccountProvider, CalendarAccountProviderInfo> = {
  microsoft: {
    id: 'microsoft',
    label: 'Microsoft 365',
    summary: 'Outlook.com and work or school accounts. Pick which calendars to show.',
    permission: 'Read your calendars (Calendars.ReadBasic): times, titles and places, never descriptions or attachments.',
    needsSecret: false,
    clientIdHint: '00000000-0000-0000-0000-000000000000',
  },
  google: {
    id: 'google',
    label: 'Google',
    summary: 'Google Calendar, personal or Workspace. Pick which calendars to show.',
    permission: 'See your calendar list and view your events, read-only.',
    needsSecret: true,
    clientIdHint: '1234-abcd.apps.googleusercontent.com',
  },
}

export function isCalendarAccountProvider(value: unknown): value is CalendarAccountProvider {
  return value === 'microsoft' || value === 'google'
}

/** Which OAuth client a provider's sign-in uses on this device. */
export interface OAuthClientState {
  provider: CalendarAccountProvider
  /** This build of Vicu has a registered client for the provider (src/main/calendar/oauth-clients.ts). */
  official: boolean
  /** The user saved their own client on this device; it is used instead of the official one. */
  own: boolean
  /** The own client's id (an id is not a secret; the client secret is never shown). */
  ownClientId?: string
}

export type OAuthClientsView = Record<CalendarAccountProvider, OAuthClientState>

/** "Use my own client": a client id, and for Google its client secret. */
export interface OwnOAuthClientInput {
  clientId: string
  clientSecret?: string
}

/** The page for an IT admin: what Vicu reads, the permission, how to grant tenant-wide consent. */
export const CALENDAR_IT_ADMIN_URL = 'https://github.com/rendyhd/Vicu/blob/main/docs/calendar-it-admins.md'
/** How to register a Microsoft or Google OAuth client ("Use my own client"). */
export const CALENDAR_OAUTH_SETUP_URL = 'https://github.com/rendyhd/Vicu/blob/main/docs/calendar-oauth-setup.md'

/** A work account whose organisation has not allowed Vicu (admin consent, conditional access). */
export const ORG_APPROVAL_MESSAGE = 'Your organisation needs to approve Vicu before it can read this calendar.'
/** The start of every message that a new sign-in fixes (a token the provider no longer takes). */
export const SIGN_IN_AGAIN_PREFIX = 'Sign in again:'

/** What would fix a connection's error: a new sign-in, an IT admin, or neither. */
export function accountProblem(message: string | undefined): 'sign-in' | 'org' | null {
  if (!message) return null
  if (message.includes(ORG_APPROVAL_MESSAGE)) return 'org'
  if (message.startsWith(SIGN_IN_AGAIN_PREFIX)) return 'sign-in'
  return null
}

/**
 * The form's own-client input checked: trimmed, the id in the provider's shape, a Google secret.
 * Gives the sentence to show when it does not fit.
 */
export function checkOwnClient(provider: CalendarAccountProvider, input: OwnOAuthClientInput): { ok: true; value: OwnOAuthClientInput } | { ok: false; error: string } {
  const clientId = String(input?.clientId ?? '').trim()
  const clientSecret = String(input?.clientSecret ?? '').trim()
  if (!clientId) return { ok: false, error: 'Enter the client id.' }
  if (clientId.length > 200 || /\s/.test(clientId)) return { ok: false, error: 'That is not a client id.' }
  if (provider === 'microsoft') {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
      return { ok: false, error: 'A Microsoft client id is the "Application (client) ID", such as 1b2c3d4e-0000-0000-0000-123456789abc.' }
    }
    return { ok: true, value: { clientId } }
  }
  if (!/\.apps\.googleusercontent\.com$/i.test(clientId)) {
    return { ok: false, error: 'A Google client id ends with .apps.googleusercontent.com.' }
  }
  if (!clientSecret) return { ok: false, error: 'Enter the client secret of the Desktop client.' }
  if (clientSecret.length > 200 || /\s/.test(clientSecret)) return { ok: false, error: 'That is not a client secret.' }
  return { ok: true, value: { clientId, clientSecret } }
}
