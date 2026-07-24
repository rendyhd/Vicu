import { BrowserWindow, net, screen } from 'electron'
import { getMainWindow } from '../quick-entry-state'
import { randomUUID } from 'crypto'
import { hostname } from 'node:os'
import { discoverProviders, type OIDCProvider } from './oidc-discovery'
import { storeJWT, storeAPIToken, storeProviderKey, storeRefreshToken } from './token-store'
import { extractRefreshToken } from './cookie-utils'

const TOKEN_EXCHANGE_TIMEOUT = 15_000
const LOGIN_TIMEOUT = 5 * 60 * 1000 // 5 minutes

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
  providerKey?: string
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

  // 3. Generate state
  const state = randomUUID()

  // 4. Build authorization URL
  // NOTE: No PKCE (code_challenge) — Vikunja's backend handles the token
  // exchange with the IdP using its own client secret, so it won't forward
  // our code_verifier. Sending PKCE here causes "invalid_grant" errors.
  // Add offline_access scope so the IdP issues longer-lived refresh tokens.
  const scope = provider.scope.includes('offline_access')
    ? provider.scope
    : `${provider.scope} offline_access`
  const authUrl =
    `${provider.auth_url}?client_id=${provider.client_id}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&state=${state}` +
    `&scope=${encodeURIComponent(scope)}`

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
      partition: 'persist:oidc-auth',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  // 5b. Diagnostic logging
  console.log('[OIDC] provider:', JSON.stringify(provider, null, 2))
  console.log('[OIDC] redirectUri:', redirectUri)
  console.log('[OIDC] authUrl:', authUrl)

  let succeeded = false
  try {
    // 6. Intercept redirects to extract authorization code
    const codePromise = new Promise<string>((resolve, reject) => {
      const checkForCode = (event: Electron.Event, url: string): void => {
        if (!url.startsWith(redirectUri)) return

        try {
          const parsed = new URL(url)
          const error = parsed.searchParams.get('error')
          if (error) {
            event.preventDefault()
            reject(
              new Error(
                `OIDC login failed: ${error} — ${parsed.searchParams.get('error_description') ?? 'unknown error'}`
              )
            )
            return
          }

          const code = parsed.searchParams.get('code')
          if (code) {
            event.preventDefault()
            resolve(code)
          }
        } catch {
          // Not a valid URL, ignore
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
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text().catch(() => '')
      throw new Error(
        `Token exchange failed (${tokenResponse.status}): ${body}`
      )
    }

    const tokenData: { token: string } = await tokenResponse.json()
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
      if (!succeeded) {
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

    const response = await net.fetch(`${baseUrl}/api/v2/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        title: `Vicu — ${deviceName}`,
        expires_at: expirationDate.toISOString(),
        permissions,
      }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`API token creation failed (${response.status}): ${body}`)
    }

    const data: { id?: number; token?: string } = await response.json()
    if (!data.token) {
      throw new Error('API token creation response missing "token" field')
    }
    const expiresAtUnix = Math.floor(expirationDate.getTime() / 1000)
    storeAPIToken(data.token, expiresAtUnix)

    // Best-effort: delete other tokens on the server that match our exact title.
    // Fire-and-forget — local + server-side new token are already in place, so
    // a failure here can never leave the user without a backup token.
    if (data.id != null) {
      cleanupOldTokens(baseUrl, jwt, data.id, deviceName).catch((err) => {
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

interface ListedToken {
  id: number
  title: string
}

interface PaginatedTokens {
  items: ListedToken[] | null
  total_pages: number
}

async function listAPITokens(baseUrl: string, jwt: string): Promise<ListedToken[]> {
  const all: ListedToken[] = []
  const PER_PAGE = 100
  const MAX_PAGES = 10
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await net.fetch(
      `${baseUrl}/api/v2/tokens?page=${page}&per_page=${PER_PAGE}`,
      { headers: { Authorization: `Bearer ${jwt}` } },
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

async function cleanupOldTokens(
  baseUrl: string,
  jwt: string,
  keepId: number,
  deviceName: string,
): Promise<void> {
  if (!deviceName) return
  const targetTitle = `Vicu — ${deviceName}`
  const tokens = await listAPITokens(baseUrl, jwt)
  const toDelete = tokens.filter((t) => t.id !== keepId && t.title === targetTitle)
  if (toDelete.length === 0) return
  console.log(
    `[Auth] Cleaning up ${toDelete.length} stale "${targetTitle}" token(s)`,
  )
  for (const t of toDelete) {
    try {
      const resp = await net.fetch(`${baseUrl}/api/v2/tokens/${t.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${jwt}` },
      })
      if (!resp.ok && resp.status !== 404) {
        console.warn(`[Auth] Delete token ${t.id} failed (${resp.status})`)
      }
    } catch (err) {
      console.warn(
        `[Auth] Delete token ${t.id} threw:`,
        err instanceof Error ? err.message : err,
      )
    }
  }
}
