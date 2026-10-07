import { BrowserWindow, net, screen } from 'electron'
import { getMainWindow } from '../quick-entry-state'
import { randomUUID } from 'crypto'
import { hostname } from 'node:os'
import { discoverProviders, type OIDCProvider } from './oidc-discovery'
import { buildAuthorizationUrl, interpretRedirect } from './oidc-url'
import {
  API_TOKEN_NO_EXPIRY,
  getAPITokenExpiry,
  getAPITokenMeta,
  hasAPIToken,
  setAPITokenMeta,
  storeJWT,
  storeAPIToken,
  storeProviderKey,
  storeRefreshToken,
  type BackupTokenMeta,
} from './token-store'
import { extractRefreshToken } from './cookie-utils'
import { isTotpChallenge, parseVikunjaProblem } from './totp'
import { AUTH_WINDOW_PARTITION } from '../web-security-policy'
import { getInstallId } from './install-id'
import {
  buildBackupTokenTitle,
  findLegacyOwnToken,
  selectSiblingTokenIds,
  type ListedToken,
} from './backup-token'

const TOKEN_EXCHANGE_TIMEOUT = 15_000
const LOGIN_TIMEOUT = 5 * 60 * 1000 // 5 minutes

// Provider details and the full sign-in URL are not written to the log in a normal run. Set
// VICU_DEBUG_OIDC=1 to see them while debugging a login (D-AUTH-4). Tokens are never logged.
const OIDC_DEBUG = process.env.VICU_DEBUG_OIDC === '1'
function oidcDebug(...args: unknown[]): void {
  if (OIDC_DEBUG) console.log('[OIDC]', ...args)
}

export class OidcTotpRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OidcTotpRequiredError'
  }
}

/**
 * Run the full interactive OIDC login flow:
 * discover providers, open in-app BrowserWindow, intercept redirect to extract
 * authorization code, exchange code for JWT, and create a backup API token.
 *
 * Uses Vikunja's own frontend callback URL as redirect_uri so no IdP
 * configuration changes are needed.
 *
 * @param vikunjaUrl  Base URL of the Vikunja instance (no trailing slash)
 * @param providerKey Optional provider key; uses first available if omitted
 * @returns The JWT string from Vikunja
 */
export async function loginWithOIDC(
  vikunjaUrl: string,
  providerKey?: string,
  totpPasscode?: string
): Promise<string> {
  const baseUrl = vikunjaUrl.replace(/\/+$/, '')

  // 1. Discover providers
  const providers = await discoverProviders(baseUrl)
  if (providers.length === 0) {
    throw new Error('No OIDC providers available on this Vikunja instance')
  }

  let provider: OIDCProvider | undefined
  if (providerKey) {
    provider = providers.find((p) => p.key === providerKey)
    if (!provider) {
      throw new Error(`OIDC provider "${providerKey}" not found`)
    }
  } else {
    provider = providers[0]
  }

  // 2. Use Vikunja's own frontend callback URL (already allowed in the IdP)
  const redirectUri = `${baseUrl}/auth/openid/${provider.key}`

  // 3. Generate state. The redirect is only accepted when it carries this value back.
  const state = randomUUID()

  // 4. Build authorization URL (see buildAuthorizationUrl: no PKCE, offline_access added).
  const authUrl = buildAuthorizationUrl(provider, redirectUri, state)

  // 5. Create visible BrowserWindow for login, centered on the main window's display
  const mainWin = getMainWindow()
  const parentBounds = mainWin?.getBounds()
  const display = parentBounds
    ? screen.getDisplayMatching(parentBounds)
    : screen.getPrimaryDisplay()
  const winWidth = 800
  const winHeight = 600
  const { x: wx, y: wy, width: dw, height: dh } = display.workArea
  let win: BrowserWindow | null = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: Math.round(wx + (dw - winWidth) / 2),
    y: Math.round(wy + (dh - winHeight) / 2),
    show: true,
    parent: mainWin ?? undefined,
    title: 'Sign in',
    webPreferences: {
      partition: AUTH_WINDOW_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  // 5b. Diagnostic logging (opt-in)
  oidcDebug('provider:', JSON.stringify(provider, null, 2))
  oidcDebug('redirectUri:', redirectUri)
  oidcDebug('authUrl:', authUrl)

  let succeeded = false
  let preserveSessionForTotpRetry = false
  try {
    // 6. Intercept redirects to extract authorization code
    const codePromise = new Promise<string>((resolve, reject) => {
      const checkForCode = (event: Electron.Event, url: string): void => {
        const outcome = interpretRedirect(url, redirectUri, state)
        if (outcome.kind === 'ignore') return
        event.preventDefault()
        if (outcome.kind === 'error') {
          reject(new Error(outcome.message))
        } else {
          resolve(outcome.code)
        }
      }

      win!.webContents.on('will-redirect', checkForCode)
      win!.webContents.on('will-navigate', checkForCode)

      // Also handle window closed by user
      win!.on('closed', () => {
        reject(new Error('Login window was closed before authentication completed'))
      })
    })

    // 7. Set up timeout
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error('OIDC login timed out after 5 minutes'))
      }, LOGIN_TIMEOUT)
    })

    // 8. Load the auth URL
    win.loadURL(authUrl)

    // 9. Race: code interception vs timeout
    const code = await Promise.race([codePromise, timeoutPromise])

    // 10. Exchange code for JWT
    const tokenUrl = `${baseUrl}/api/v2/auth/openid/${provider.key}/callback`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TOKEN_EXCHANGE_TIMEOUT)

    const tokenResponse = await net.fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        scope: provider.scope,
        redirect_url: redirectUri,
        ...(totpPasscode ? { totp_passcode: totpPasscode } : {}),
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text().catch(() => '')
      const { errorCode, message } = parseVikunjaProblem(body, tokenResponse.status)
      if (isTotpChallenge(tokenResponse.status, errorCode)) {
        preserveSessionForTotpRetry = true
        throw new OidcTotpRequiredError(message)
      }
      throw new Error(
        `Token exchange failed (${tokenResponse.status}): ${body}`
      )
    }

    const tokenData = await tokenResponse.json() as { token: string }
    const jwt = tokenData.token
    if (!jwt) {
      throw new Error('Token exchange response missing "token" field')
    }

    // 11. Store JWT, refresh token, and provider key
    storeJWT(jwt)
    const refreshToken = extractRefreshToken(tokenResponse)
    if (refreshToken) {
      storeRefreshToken(refreshToken)
    }
    storeProviderKey(provider.key)
    succeeded = true

    // 12. Create backup API token (awaited, but login succeeds even if this fails)
    try {
      await createBackupAPIToken(baseUrl, jwt)
    } catch (err) {
      console.error(
        '[OIDC] CRITICAL: failed to create backup API token — user will be locked out on next refresh failure:',
        err instanceof Error ? err.message : err
      )
    }

    // 13. Return JWT
    return jwt
  } finally {
    if (win && !win.isDestroyed()) {
      if (!succeeded && !preserveSessionForTotpRetry) {
        // Clear session cookies on failure so retries start fresh
        await win.webContents.session.clearStorageData().catch(() => {})
      }
      win.destroy()
    }
    win = null
  }
}

/**
 * Shape of `GET /api/v2/routes`: a group → method → route-detail map.
 * We only care about the second-level keys (the permission names).
 */
type AvailableRoutes = Record<string, Record<string, unknown>>

/**
 * Fetch the full list of API token permission groups from Vikunja.
 * Requires authentication (JWT or valid API token).
 */
async function fetchAvailableRoutes(baseUrl: string, jwt: string): Promise<AvailableRoutes> {
  const response = await net.fetch(`${baseUrl}/api/v2/routes`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${jwt}` },
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Failed to fetch available routes (${response.status}): ${body}`)
  }
  return (await response.json()) as AvailableRoutes
}

/**
 * Expand the routes map into a concrete full-access permissions object,
 * mirroring the Vikunja frontend's "Full access" preset (`{"*": "*"}`).
 * The wire format is always the expanded form — `*` is UI shorthand only.
 */
function buildFullAccessPermissions(routes: AvailableRoutes): Record<string, string[]> {
  const permissions: Record<string, string[]> = {}
  for (const [group, methods] of Object.entries(routes)) {
    const keys = Object.keys(methods)
    if (keys.length > 0) {
      permissions[group] = keys
    }
  }
  return permissions
}

export async function createBackupAPIToken(
  baseUrl: string,
  jwt: string
): Promise<void> {
  const expirationDate = new Date()
  expirationDate.setDate(expirationDate.getDate() + 365)

  const doCreate = async (): Promise<void> => {
    const routes = await fetchAvailableRoutes(baseUrl, jwt)
    const permissions = buildFullAccessPermissions(routes)
    if (Object.keys(permissions).length === 0) {
      throw new Error('No API permission groups returned from /api/v2/routes')
    }

    const deviceName = hostname() || 'Unknown device'
    const installId = getInstallId()

    const response = await net.fetch(`${baseUrl}/api/v2/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        title: buildBackupTokenTitle(deviceName, installId),
        expires_at: expirationDate.toISOString(),
        permissions,
      }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`API token creation failed (${response.status}): ${body}`)
    }

    const data = await response.json() as { id?: number; token?: string }
    if (!data.token) {
      throw new Error('API token creation response missing "token" field')
    }
    const expiresAtUnix = Math.floor(expirationDate.getTime() / 1000)

    // Remember what the new token replaces before it overwrites the stored one.
    const previousMeta = getAPITokenMeta()
    const previousExpiry = getAPITokenExpiry()

    // Keep the server-side id with the token so logout can revoke it.
    storeAPIToken(
      data.token,
      expiresAtUnix,
      typeof data.id === 'number' ? { id: data.id, baseUrl } : undefined
    )

    // Best-effort: delete this install's older tokens on the server.
    // Fire-and-forget — local + server-side new token are already in place, so
    // a failure here can never leave the user without a backup token.
    if (typeof data.id === 'number') {
      cleanupOldTokens(baseUrl, jwt, {
        keepId: data.id,
        deviceName,
        installId,
        previousMeta,
        previousExpiry,
      }).catch((err) => {
        console.warn(
          '[Auth] Old token cleanup failed (non-fatal):',
          err instanceof Error ? err.message : err
        )
      })
    }
  }

  try {
    await doCreate()
  } catch (firstErr) {
    // Retry once on failure (network errors, transient server errors)
    console.warn('[Auth] Backup API token creation failed, retrying once:', firstErr)
    await doCreate()
  }
}

interface PaginatedTokens {
  items: ListedToken[] | null
  total_pages: number
}

async function listAPITokens(baseUrl: string, bearer: string): Promise<ListedToken[]> {
  const all: ListedToken[] = []
  const PER_PAGE = 100
  const MAX_PAGES = 10
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await net.fetch(
      `${baseUrl}/api/v2/tokens?page=${page}&per_page=${PER_PAGE}`,
      { headers: { Authorization: `Bearer ${bearer}` } },
    )
    if (!resp.ok) {
      throw new Error(`List tokens failed (${resp.status})`)
    }
    const body = (await resp.json()) as PaginatedTokens
    const batch = body.items ?? []
    if (batch.length === 0) break
    all.push(...batch)
    if (page >= body.total_pages) break
  }
  return all
}

const TOKEN_DELETE_TIMEOUT = 8_000

/** DELETE /tokens/{id}. A token that is already gone (404) counts as deleted. */
async function deleteAPIToken(baseUrl: string, bearer: string, id: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TOKEN_DELETE_TIMEOUT)
  try {
    const resp = await net.fetch(`${baseUrl}/api/v2/tokens/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${bearer}` },
      signal: controller.signal,
    })
    if (resp.ok || resp.status === 404) return true
    console.warn(`[Auth] Delete token ${id} failed (${resp.status})`)
    return false
  } catch (err) {
    console.warn(`[Auth] Delete token ${id} threw:`, err instanceof Error ? err.message : err)
    return false
  } finally {
    clearTimeout(timer)
  }
}

interface CleanupContext {
  keepId: number
  deviceName: string
  installId: string
  /** The backup token this install held before the new one was stored. */
  previousMeta: BackupTokenMeta | null
  previousExpiry: number | null
}

/**
 * Delete the backup tokens a newly created token replaces. Only tokens that
 * provably belong to this install are touched:
 * - tokens whose title carries this install's id,
 * - the token id stored for the previous backup token (same server only),
 * - for installs upgraded from a version without ids: the one token with the old
 *   `Vicu — <host name>` title whose expiry matches the locally stored expiry
 *   (see findLegacyOwnToken). Other legacy tokens with the same title may belong
 *   to a different machine with the same host name, so they are left alone.
 */
async function cleanupOldTokens(baseUrl: string, jwt: string, ctx: CleanupContext): Promise<void> {
  const tokens = await listAPITokens(baseUrl, jwt)
  const ids = new Set(selectSiblingTokenIds(tokens, ctx.installId, ctx.keepId))

  if (ctx.previousMeta && ctx.previousMeta.baseUrl === baseUrl) {
    ids.add(ctx.previousMeta.id)
  } else if (!ctx.previousMeta) {
    const legacy = findLegacyOwnToken(tokens, ctx.deviceName, ctx.previousExpiry)
    if (legacy) ids.add(legacy.id)
  }
  ids.delete(ctx.keepId)
  if (ids.size === 0) return

  console.log(`[Auth] Cleaning up ${ids.size} stale backup token(s)`)
  for (const id of ids) {
    await deleteAPIToken(baseUrl, jwt, id)
  }
}

// Looking up the id of a pre-upgrade token costs a request, so try once per run.
let legacyLookupDone = false

/**
 * The server-side id of the stored backup token, or null when Vicu did not
 * create it (user-provided API token, JWT kept as fallback) or it cannot be
 * identified. Installs upgraded from a version that did not record ids resolve
 * it by lookup (findLegacyOwnToken) and remember the result.
 */
async function resolveBackupTokenId(baseUrl: string, bearer: string, force = false): Promise<number | null> {
  const meta = getAPITokenMeta()
  if (meta) return meta.baseUrl === baseUrl ? meta.id : null

  const expiry = getAPITokenExpiry()
  if (!hasAPIToken() || expiry == null || expiry === API_TOKEN_NO_EXPIRY) return null
  if (legacyLookupDone && !force) return null
  legacyLookupDone = true

  try {
    const tokens = await listAPITokens(baseUrl, bearer)
    const legacy = findLegacyOwnToken(tokens, hostname() || 'Unknown device', expiry)
    if (!legacy) return null
    setAPITokenMeta({ id: legacy.id, baseUrl })
    return legacy.id
  } catch (err) {
    console.warn('[Auth] Could not look up backup token id:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Record the id of a backup token created by an older version, so a later logout
 * can revoke it. Safe to call on every refresh; it does network work at most once
 * per run and only when no id is stored yet.
 */
export async function adoptLegacyBackupTokenId(baseUrl: string, jwt: string): Promise<void> {
  await resolveBackupTokenId(baseUrl, jwt)
}

/**
 * Best-effort revocation of the backup API token on logout. Never throws: a
 * failure (offline, expired session) only leaves the token to expire on its own.
 * `bearer` must be a credential the server still accepts (a valid JWT, or the
 * API token itself).
 */
export async function revokeStoredBackupAPIToken(baseUrl: string, bearer: string): Promise<boolean> {
  try {
    const id = await resolveBackupTokenId(baseUrl, bearer, true)
    if (id == null) return false
    return await deleteAPIToken(baseUrl, bearer, id)
  } catch (err) {
    console.warn('[Auth] Backup token revocation failed:', err instanceof Error ? err.message : err)
    return false
  }
}
