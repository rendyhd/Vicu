import { BrowserWindow, net } from 'electron'
import { randomUUID } from 'crypto'
import { discoverProviders } from './oidc-discovery'
import { getProviderKey, storeJWT, storeRefreshToken } from './token-store'
import { extractRefreshToken } from './cookie-utils'

const SILENT_AUTH_TIMEOUT = 15_000
const TOKEN_EXCHANGE_TIMEOUT = 15_000

/**
 * Attempt to silently re-authenticate using the OIDC provider's existing
 * session (cookies stored in the `persist:oidc-auth` partition, shared with
 * the interactive login flow).
 *
 * Uses `prompt=none` to avoid any user interaction — the provider will either
 * redirect with a new authorization code (session still valid) or respond
 * with `error=login_required` (session expired).
 *
 * Uses Vikunja's own frontend callback URL as redirect_uri (same as
 * interactive login) and intercepts the redirect to extract the code.
 *
 * @param vikunjaUrl  Base URL of the Vikunja instance (no trailing slash)
 * @returns The new JWT string
 * @throws If no provider is stored, session is expired, or any step fails
 */
export async function silentReauth(vikunjaUrl: string): Promise<string> {
  const baseUrl = vikunjaUrl.replace(/\/+$/, '')

  // 1. Get the stored provider key
  const providerKey = getProviderKey()
  if (!providerKey) {
    throw new Error('No OIDC provider key stored — cannot attempt silent reauth')
  }

  // 2. Discover providers and find the matching one
  const providers = await discoverProviders(baseUrl)
  const provider = providers.find((p) => p.key === providerKey)
  if (!provider) {
    throw new Error(
      `OIDC provider "${providerKey}" not found on this Vikunja instance`
    )
  }

  // 3. Use Vikunja's own frontend callback URL (same as interactive login)
  const redirectUri = `${baseUrl}/auth/openid/${provider.key}`

  // 4. Generate state
  const state = randomUUID()

  // 5. Build auth URL with prompt=none (no PKCE — same reason as interactive login)
  const authUrl =
    `${provider.auth_url}?client_id=${provider.client_id}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&state=${state}` +
    `&scope=${encodeURIComponent(provider.scope)}` +
    `&prompt=none`

  // 6. Create hidden BrowserWindow with persistent session partition
  //    (shares cookies with interactive login so the IdP session is available)
  let win: BrowserWindow | null = new BrowserWindow({
    show: false,
    width: 0,
    height: 0,
    webPreferences: {
      partition: 'persist:oidc-auth',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  try {
    // 7. Intercept redirects for both code and error detection
    const codePromise = new Promise<string>((resolve, reject) => {
      const checkRedirect = (event: Electron.Event, url: string): void => {
        if (!url.startsWith(redirectUri)) return

        try {
          const parsed = new URL(url)
          const error = parsed.searchParams.get('error')
          if (error) {
            event.preventDefault()
            reject(
              new Error(
                `Silent reauth failed: ${error} — ${parsed.searchParams.get('error_description') ?? 'session expired'}`
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

      win!.webContents.on('will-redirect', checkRedirect)
      win!.webContents.on('will-navigate', checkRedirect)
    })

    // 8. Set up timeout
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error('Silent reauth timed out after 15 seconds'))
      }, SILENT_AUTH_TIMEOUT)
    })

    // 9. Load the auth URL — the provider will redirect automatically
    win.loadURL(authUrl)

    // 10. Race: code interception vs error vs timeout
    const code = await Promise.race([codePromise, timeoutPromise])

    // 11. Exchange code for JWT
    const tokenUrl = `${baseUrl}/api/v1/auth/openid/${provider.key}/callback`
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
        `Silent reauth token exchange failed (${tokenResponse.status}): ${body}`
      )
    }

    const tokenData: { token: string } = await tokenResponse.json()
    const jwt = tokenData.token
    if (!jwt) {
      throw new Error('Token exchange response missing "token" field')
    }

    // 12. Store the new JWT and refresh token
    storeJWT(jwt)
    const refreshToken = extractRefreshToken(tokenResponse)
    if (refreshToken) {
      storeRefreshToken(refreshToken)
    }

    return jwt
  } finally {
    if (win && !win.isDestroyed()) {
      win.destroy()
    }
    win = null
  }
}
