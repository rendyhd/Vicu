import type { Handle } from '../main/handlers/types'
import {
  applyConfigPatch,
  applyConnectionFields,
  connectionKeysIn,
  isConnectionFields,
  loadConfig,
  saveConfig,
  type AppConfig,
  type ConnectionFields,
} from '../main/config'
import { testConnection } from '../main/api-client'
import { tokenForConnectionTest } from '../main/connection-test-token'
import { discoverAuthMethods, discoverProviders } from '../main/auth/oidc-discovery'
import { fetchCurrentUser } from '../main/auth/user-info'
import { claimAccountData, rememberKnownUser } from '../main/known-user'
import { syncCustomLists } from '../main/custom-list-service'
import { syncProLedger } from '../main/pro-ledger-service'
import { inboxChosenAtSetup, readSetupPreferences, setSyncedPreference } from '../main/synced-preferences'
import { isDeepLinkAllowed, safeExternalUrl } from '../main/web-security-policy'
import { dateFormatFor, isClockFormat, type DateFormat } from '../shared/date-display'
import { availableLanguages, resolveLanguage, type LanguageInfo } from '../shared/i18n'
import { flushDocuments } from './host/storage'
import { sendToAllWindows } from './host/windows'
import { storeApiToken, storedApiToken } from './host/auth'
import { accountChanged, serverUrl, tokenForRequest } from './account'
import { registerFileHandlers } from './files'
import {
  beginOidcSignIn,
  loginWithPassword,
  logoutSession,
  renewSession,
  sessionTokenSync,
  takePendingSignIn,
} from './session'

// The web host's own handlers: the channels the desktop answers with Electron or Node (the config
// file, the sign-in windows, the clipboard, the language of the computer), answered here with what
// a browser has. The handlers that need neither are shared with the desktop
// (src/main/handlers/portable.ts, src/main/collab-ipc.ts).
//
// A handler never trusts the server address the page passes: the web version talks to its own
// origin only, so a token is never sent anywhere else.

/** Remembers the provider of the last OIDC sign-in, so signing in again starts the same way. */
const OIDC_PROVIDER_KEY = 'vicu-web-oidc-provider'
/** Set by Setup's "Remember on this browser" for an API token; the page writes it (see host/auth.ts). */
const REMEMBER_TOKEN_KEY = 'vicu-web-remember-token'

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Storage is blocked: the choice lasts for this page only.
  }
}

// --- Dates and language: the browser's, unless Settings says otherwise -------------------------

function currentDateFormat(config: Pick<AppConfig, 'clock_format'> | null = loadConfig()): DateFormat {
  const clock = config?.clock_format
  return dateFormatFor(navigator.language || 'en-US', isClockFormat(clock) ? clock : 'system')
}

function currentLanguage(config: Pick<AppConfig, 'language'> | null = loadConfig()): LanguageInfo {
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language]
  return resolveLanguage(config?.language, preferred, availableLanguages())
}

let dateFormatSent: string | null = null
let languageSent: string | null = null

/** After the config changed (here or in another tab): tell the page what it phrases text with. */
export function announceConfigChange(config: AppConfig | null = loadConfig()): void {
  if (dateFormatSent !== null) {
    const format = currentDateFormat(config)
    const snapshot = JSON.stringify(format)
    if (snapshot !== dateFormatSent) {
      dateFormatSent = snapshot
      sendToAllWindows('date-format-changed', format)
    }
  }
  if (languageSent !== null) {
    const info = currentLanguage(config)
    const snapshot = JSON.stringify(info)
    if (snapshot !== languageSent) {
      languageSent = snapshot
      sendToAllWindows('language-changed', info)
    }
  }
}

// --- Config ---------------------------------------------------------------------------------

function persistConfig(config: AppConfig): void {
  // An API token is kept by host/auth.ts (for this tab, or for this browser when asked), never in
  // the config document.
  if (config.auth_method === 'api_token' && config.api_token) {
    storeApiToken(config.api_token, readLocal(REMEMBER_TOKEN_KEY) === '1')
    config.api_token = ''
  }
  saveConfig(config)
  announceConfigChange(config)
  if (config.custom_lists?.length || config.custom_lists_sync?.dirty) void syncCustomLists()
}

/** Another user of this server signs in: the previous user's lists and settings go first. */
async function claimAccountDataFor(connection: ConnectionFields): Promise<void> {
  const current = loadConfig()
  if (!connection.vikunja_url || !current?.account_owner || !current.vikunja_url) return
  const token = connection.auth_method === 'api_token'
    ? (connection.api_token || storedApiToken())
    : sessionTokenSync()
  if (!token) return
  const user = await fetchCurrentUser(serverUrl(), token).catch(() => null)
  if (user) claimAccountData(serverUrl(), user.id)
}

export function registerWebHandlers(handle: Handle): void {
  handle('get-config', () => loadConfig())

  handle('get-date-format', () => {
    const format = currentDateFormat()
    dateFormatSent = JSON.stringify(format)
    return format
  })

  handle('get-language', () => {
    const info = currentLanguage()
    languageSent = JSON.stringify(info)
    return info
  })

  handle('save-config-patch', (_event, patch: unknown) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid config patch')
    const connectionKeys = connectionKeysIn(patch)
    if (connectionKeys.length > 0) {
      throw new Error(`Connection settings (${connectionKeys.join(', ')}) are saved with save-connection-config, not a config patch`)
    }
    const latest = loadConfig()
    if (!latest) return
    const next = applyConfigPatch(latest, patch as Record<string, unknown>)
    persistConfig(next)
    // The Inbox is a synced setting (cross-app semantics 11.4).
    if ('inbox_project_id' in patch && next.inbox_project_id > 0 && next.inbox_project_id !== latest.inbox_project_id && next.vikunja_url) {
      setSyncedPreference('inbox_project_id', next.inbox_project_id)
    }
    if (next.pro_enabled && !latest.pro_enabled) void syncProLedger()
  })

  // Setup, sign-in and sign-out. The page passes the address it showed; here it is the page's own
  // origin, or nothing at all (signed out).
  handle('save-connection-config', async (_event, raw: unknown) => {
    if (!isConnectionFields(raw)) throw new Error('Invalid connection settings')
    const connection: ConnectionFields = { ...raw, vikunja_url: raw.vikunja_url.trim() ? serverUrl() : '' }
    await claimAccountDataFor(connection)
    if (!connection.vikunja_url) storeApiToken(null)
    persistConfig(applyConnectionFields(loadConfig(), connection))
    accountChanged()
    if (connection.vikunja_url && connection.inbox_project_id) inboxChosenAtSetup(connection.vikunja_url, connection.inbox_project_id)
  })

  handle('synced-prefs:read-for-setup', async (_event, _url: unknown, token: unknown) => {
    const typed = typeof token === 'string' ? token.trim() : ''
    const use = typed || (await tokenForRequest()) || ''
    if (!use) return { inboxProjectId: null, defaultProjectId: null }
    return readSetupPreferences(serverUrl(), use)
  })

  handle('test-connection', (_event, _url: unknown, token: unknown) => {
    const config = loadConfig()
    const saved = config?.auth_method === 'api_token' ? storedApiToken() : null
    return testConnection(serverUrl(), tokenForConnectionTest(serverUrl(), typeof token === 'string' ? token : '', serverUrl(), saved))
  })

  // --- Sign-in -------------------------------------------------------------------------------

  handle('auth:discover-oidc', () => discoverProviders(serverUrl()))
  handle('auth:discover-methods', () => discoverAuthMethods(serverUrl()))

  // An OIDC sign-in leaves the page for the provider, so this call never answers on success: the
  // page loads again at the provider's answer and `auth:pending-sign-in` says how it went.
  const oidcSignIn = async (_event: unknown, _url: unknown, providerKey: unknown, totpPasscode?: unknown) => {
    try {
      const providers = await discoverProviders(serverUrl())
      const provider = providers.find((candidate) => candidate.key === providerKey)
      if (!provider) return { success: false, error: 'This sign-in provider is no longer offered by the server' }
      writeLocal(OIDC_PROVIDER_KEY, provider.key)
      // The connection Setup just saved must be in storage when the page comes back.
      await flushDocuments()
      return await beginOidcSignIn(provider, typeof totpPasscode === 'string' && totpPasscode ? totpPasscode : undefined)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Login failed' }
    }
  }
  handle('auth:login-oidc', oidcSignIn)
  handle('auth:login-oidc-browser', oidcSignIn)
  handle('auth:cancel-oidc-browser', () => {})
  handle('auth:oidc-sign-in', () => ({ mode: 'window' as const, providerKey: readLocal(OIDC_PROVIDER_KEY) }))
  handle('auth:pending-sign-in', () => {
    const pending = takePendingSignIn()
    // The session started: whoever signed in may be someone else than before.
    if (pending && !pending.error && !pending.totpRequired) accountChanged()
    return pending
  })

  handle('auth:login-password', async (_event, _url: unknown, username: unknown, password: unknown, totpPasscode?: unknown) => {
    if (typeof username !== 'string' || typeof password !== 'string') return { success: false, error: 'Invalid username or password' }
    const result = await loginWithPassword(username, password, typeof totpPasscode === 'string' && totpPasscode ? totpPasscode : undefined)
    if (!result.success) return result
    const config = loadConfig()
    if (config && config.last_username !== username) saveConfig({ ...config, last_username: username })
    accountChanged()
    // The JWT stays in this module's memory; the page only learns that it worked.
    return { success: true }
  })

  handle('auth:get-user', async () => {
    const token = await tokenForRequest()
    if (!token) return null
    const user = await fetchCurrentUser(serverUrl(), token)
    if (user) rememberKnownUser(serverUrl(), user.id)
    return user
  })

  // Setup is shown until it is finished (an Inbox chosen), so a sign-in that left for the provider
  // and came back, or a reload half way, picks up at the step it was at.
  handle('auth:check', async () => {
    const config = loadConfig()
    if (!config?.vikunja_url) return { status: 'unconfigured' as const }
    const finished = config.inbox_project_id > 0
    if (config.auth_method === 'api_token') {
      return { status: storedApiToken() && finished ? 'authenticated' as const : 'unconfigured' as const }
    }
    if (!sessionTokenSync()) {
      const outcome = await renewSession()
      if (outcome === 'ended') {
        if (!finished) return { status: 'unconfigured' as const }
        return {
          status: 'reauth-needed' as const,
          authMethod: config.auth_method,
          vikunjaUrl: serverUrl(),
          lastUsername: config.last_username,
        }
      }
      // 'unreachable': the server cannot be asked now. The app opens with what it has; its
      // requests fail as "not connected", not as "sign in again".
    }
    return { status: finished ? 'authenticated' as const : 'unconfigured' as const }
  })

  // Rejects when the server could not be told: the page then says so and stays signed in, because
  // the session would still work for whoever uses this browser next.
  handle('auth:logout', async () => {
    let providerSignOutUrl: string | undefined
    if (loadConfig()?.auth_method !== 'api_token') {
      const outcome = await logoutSession()
      if (!outcome.ended) throw new Error('The server could not be reached, so the session was not ended')
      providerSignOutUrl = outcome.providerSignOutUrl
    }
    storeApiToken(null)
    writeLocal(REMEMBER_TOKEN_KEY, null)
    accountChanged()
    // An SSO session also lives at the identity provider; the page goes there to end it.
    return providerSignOutUrl ? { providerSignOutUrl } : undefined
  })

  // --- Links ---------------------------------------------------------------------------------

  // A link of a task or of the notes: a web or mail address opens in a new tab. A note link
  // (`obsidian:`) has nothing to open it in a browser, so it is not followed.
  handle('open-deep-link', (_event, url: unknown) => {
    if (typeof url !== 'string' || !isDeepLinkAllowed(url)) return
    const safe = safeExternalUrl(url)
    let scheme = ''
    try {
      scheme = new URL(safe).protocol
    } catch {
      return
    }
    if (scheme === 'mailto:') {
      const link = document.createElement('a')
      link.href = safe
      link.click()
    } else if (scheme === 'http:' || scheme === 'https:') {
      window.open(safe, '_blank', 'noopener,noreferrer')
    }
  })

  // The count on the app icon has no place in a tab.
  handle('set-task-badge', () => {})

  registerFileHandlers(handle)
}
